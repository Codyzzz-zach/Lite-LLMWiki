import type { Command } from "commander";
import { createInterface } from "node:readline";
import { extname, join } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { loadConfig } from "../../config.js";
import { DeepSeekClient } from "../../core/client.js";
import { KnowledgeStore } from "../../knowledge/store.js";
import { loadFromFile } from "../../ingest/loader.js";
import { loadFromPdf } from "../../ingest/pdf-loader.js";
import { loadFromTex } from "../../ingest/tex-loader.js";
import { proIngest } from "../../ingest/listening.js";
import { filterByPolicy } from "../../ingest/policy.js";
import type { Policy } from "../../ingest/policy.js";
import type { IngestOptions, Proposition, ConfirmedProposition, WikiPage, WikiNodeDraft } from "../../types.js";
import { auditWiki, writeAuditResults } from "../../knowledge/audit.js";
import { writeSemanticAuditResults } from "../../knowledge/semantic-audit.js";
import { loadApiKey } from "../../config.js";

export function registerIngestCommand(program: Command): void {
  program
    .command("ingest")
    .description("Ingest a file or TeX folder — extract → 主线选择 → 逐条确认 → wiki")
    .argument("<path>", "path to .md / .tex file, or a TeX project folder")
    .option("-m, --anchor <text>", "human anchor")
    .option("-t, --thread <id>", 'skip thread selection: "all" or thread number', "")
    .option("--auto", "非交互自动确认（需配合 --policy）")
    .option("--policy <name>", "自动确认策略: conservative | balanced | expansive", "balanced")
    .option("--json", "输出结构化 JSON 到 stdout")
    .option("--dry-run", "不写 wiki，只输出报告")
    .option("--no-audit", "跳过自动 audit（默认在 --auto 模式下自动执行）")
    .action(async (path: string, opts: { anchor?: string; thread?: string; auto?: boolean; policy?: string; json?: boolean; dryRun?: boolean; audit?: boolean }) => {
      const originalLog = console.log;
      if (opts.json) {
        console.log = (...args: unknown[]) => console.error(...args);
      }
      try {
        await runIngest({
          file: path,
          anchor: opts.anchor,
          mode: opts.thread || undefined,
          auto: opts.auto,
          policy: opts.policy,
          json: opts.json,
          dryRun: opts.dryRun,
          noAudit: opts.audit === false,
        });
      } finally {
        console.log = originalLog;
      }
    });
}

function readLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (a) => { rl.close(); resolve(a.trim()); });
  });
}

/** 扫描 TeX 文件夹，找包含 \documentclass 的主 .tex 文件 */
function findMainTex(dir: string): string {
  if (!existsSync(dir)) throw new Error(`Directory not found: ${dir}`);
  const files = readdirSync(dir).filter((f) => f.endsWith(".tex"));
  if (files.length === 0) throw new Error(`No .tex files found in ${dir}`);
  // 优先找含 \documentclass 的
  for (const f of files) {
    const content = readFileSync(join(dir, f), "utf-8");
    if (content.includes("\\documentclass")) return join(dir, f);
  }
  // fallback: 选体积最大的（通常是主文件）
  let largest = files[0]!;
  for (const f of files) {
    if (statSync(join(dir, f)).size > statSync(join(dir, largest)).size) largest = f;
  }
  console.warn(`  ⚠️  未找到含 \\documentclass 的 .tex，自动选择 ${largest}`);
  return join(dir, largest);
}

async function runIngest(opts: IngestOptions): Promise<void> {
  const config = loadConfig();
  if (!config.apiKey) {
    if (opts.json) {
      printJsonError("DEEPSEEK_API_KEY not set");
    } else {
      console.error("  ❌  DEEPSEEK_API_KEY not set.");
    }
    process.exit(1);
  }

  console.log(`\n  📥  ingesting: ${opts.file}`);
  if (opts.anchor) console.log(`  🎯  anchor:    "${opts.anchor}"`);
  console.log("");

  // ——— 加载（单文件 / TeX 文件夹）
  let sourcePath = opts.file;
  const ext = extname(opts.file).toLowerCase();
  let stat: ReturnType<typeof statSync> | undefined;

  try { stat = statSync(opts.file); } catch { /* not found, treat as file path */ }

  if (stat?.isDirectory()) {
    sourcePath = findMainTex(opts.file);
    console.log(`  📂  TeX project detected, main: ${sourcePath}\n`);
  }

  console.log("  [1] Loading source...");
  const source = stat?.isDirectory() || ext === ".tex"
    ? await loadFromTex(sourcePath, config, { chunkTokenTarget: config.chunkTokenTarget, chunkOverlapTokens: config.chunkOverlapTokens })
    : ext === ".pdf"
      ? await loadFromPdf(opts.file, { chunkTokenTarget: config.chunkTokenTarget, chunkOverlapTokens: config.chunkOverlapTokens, config })
      : loadFromFile(opts.file, { chunkTokenTarget: config.chunkTokenTarget, chunkOverlapTokens: config.chunkOverlapTokens });
  console.log(`        title:   ${source.title}\n        chunks:  ${source.chunks.length}\n        tokens:  ~${source.totalTokens}\n`);

  const client = new DeepSeekClient(config);

  // ——— Phase 1: Extract ———
  console.log("  [2] Extract — Pro 初读...\n");
  let br: Awaited<ReturnType<typeof proIngest>>;
  try {
    br = await proIngest({ source, anchor: opts.anchor, config, client, mode: "extract" });
  } catch (err) {
    const message = `Extract failed: ${(err as Error).message}`;
    if (opts.json) {
      printJsonResult({
        ok: false,
        sourceId: source.id,
        created: [],
        updated: [],
        skipped: [],
        coverage: {
          coveredChunks: 0,
          totalChunks: source.chunks.length,
          uncoveredReasons: [message],
        },
      });
    } else {
      console.error(`  ❌  ${message}\n`);
    }
    process.exit(1);
  }

  const threads = br.mainThreads ?? [];
  const allProps = br.propositions ?? [];

  if (threads.length === 0 || allProps.length === 0) {
    console.log("  ⚠️  未生成内容，跳过\n");
    return;
  }

  // ——— 主线选择（支持 --thread 跳过） ———
  let selectedId = 0;
  const threadOpt = opts.mode; // --thread 值传入 mode

  if (opts.auto && !threadOpt) {
    // --auto 模式下非交互，自动全选
    selectedId = 0;
    console.log(`  📋 ${threads.length} 条主线（--auto 全选）\n`);
  } else if (source.chunks.length < 5 || threadOpt === "all") {
    selectedId = 0;
    const label = source.chunks.length < 5 ? "短文档，自动全部" : "--thread all";
    console.log(`  📋 ${threads.length} 条主线（${label}）\n`);
  } else if (threadOpt) {
    const n = Number(threadOpt);
    if (threads.some((t) => t.id === n)) {
      selectedId = n;
      console.log(`  📋 主线 [${n}]: ${threads.find((t) => t.id === n)?.title}\n`);
    } else {
      console.error(`  ❌  --thread ${threadOpt} 无效，可用: ${threads.map((t) => t.id).join("/")}`);
      process.exit(1);
    }
  } else {
    console.log(`  📋 ${threads.length} 条主线:\n`);
    for (const t of threads) {
      console.log(`  [${t.id}] ${t.title}`);
      console.log(`      ${t.description}\n`);
    }
    while (true) {
      const input = await readLine("  ❯ 选主线编号（回车=全部）: ");
      if (!input) { selectedId = 0; break; }
      const n = Number(input);
      if (threads.some((t) => t.id === n)) { selectedId = n; break; }
      console.log(`      输入 ${threads.map((t) => t.id).join("/")}`);
    }
  }

  const targetProps = selectedId === 0
    ? allProps
    : allProps.filter((p) => p.threadId === selectedId);

  if (targetProps.length === 0) {
    console.log("  该主线下无 proposition\n");
    return;
  }

  console.log(`\n  [3] 逐条确认 — ${targetProps.length} 条 proposition\n`);

  // ——— Phase 2: 逐条确认 ———
  const confirmed: ConfirmedProposition[] = [];
  const skippedReasons: Array<{ propId: number; reason: string }> = [];

  if (opts.auto) {
    // ── --auto 模式：filterByPolicy 自动确认 ──
    const policy = (opts.policy as Policy) ?? "balanced";
    console.log(`        policy: ${policy}\n`);

    for (const prop of targetProps) {
      const result = filterByPolicy(policy, {
        kind: prop.kind,
        confidence: prop.confidence,
        evidence: prop.evidence,
      });

      if (result.accept) {
        confirmed.push({
          propId: prop.id, threadId: prop.threadId,
          claim: prop.claim, aiReading: prop.aiReading,
          chunkRefs: prop.chunkRefs, revision: prop.revision,
          status: "confirmed",
          counterIntuitive: prop.counterIntuitive,
          counterIntuitiveReason: prop.counterIntuitiveReason,
        });
        console.log(`  ✅ [${prop.id}] auto-confirmed (${prop.kind ?? "?"} conf=${(prop.confidence ?? 0).toFixed(2)})`);
      } else {
        skippedReasons.push({ propId: prop.id, reason: result.reason ?? "unknown" });
        console.log(`  ⏭️  [${prop.id}] skipped: ${result.reason}`);
      }
    }
    console.log(`\n  => ${confirmed.length} confirmed, ${skippedReasons.length} skipped\n`);
  } else {

  for (let pi = 0; pi < targetProps.length; pi++) {
    const prop = targetProps[pi]!;
    let current: Proposition = { ...prop };
    let mCount = 0;
    const originalReading = prop.aiReading;
    const originalChunks = [...prop.chunkRefs];

    while (true) {
      const revTag = current.revision > 0 ? ` (r${current.revision})` : "";
      const remainCount = targetProps.length - pi;
      console.log(`  ─── [${current.id}/${targetProps.length}]${revTag}  (剩余 ${remainCount}) ───`);
      console.log(`  📄  ${current.claim}`);
      console.log(`  🤖  ${current.aiReading}`);
      console.log(`      (Chunk ${current.chunkRefs.join(", ")})`);
      if (current.counterIntuitive && current.counterIntuitiveReason) {
        console.log(`  ⚡ 反直觉: ${current.counterIntuitiveReason}`);
      }
      console.log("");

      const raw = await readLine("  [a]对齐  [s]跳过  [m]不同角度  [a all]批量确认  ❯ ");
      const choice = raw.toLowerCase().trim();

      if (choice === "a all") {
        confirmed.push({
          propId: current.id, threadId: current.threadId,
          claim: current.claim, aiReading: current.aiReading,
          chunkRefs: current.chunkRefs, revision: current.revision,
          status: "confirmed",
          counterIntuitive: current.counterIntuitive,
          counterIntuitiveReason: current.counterIntuitiveReason,
        });
        console.log("  ✅ 已确认");
        for (let j = pi + 1; j < targetProps.length; j++) {
          const rest = targetProps[j]!;
          confirmed.push({
            propId: rest.id, threadId: rest.threadId,
            claim: rest.claim, aiReading: rest.aiReading,
            chunkRefs: rest.chunkRefs, revision: 0,
            status: "confirmed",
            counterIntuitive: rest.counterIntuitive,
            counterIntuitiveReason: rest.counterIntuitiveReason,
          });
          console.log(`  ✅ [${rest.id}] 批量确认`);
        }
        console.log("");
        pi = targetProps.length;
        break;
      }

      if (choice === "a") {
        confirmed.push({
          propId: current.id, threadId: current.threadId,
          claim: current.claim, aiReading: current.aiReading,
          chunkRefs: current.chunkRefs, revision: current.revision,
          status: "confirmed",
          counterIntuitive: current.counterIntuitive,
          counterIntuitiveReason: current.counterIntuitiveReason,
        });
        console.log("  ✅ 已确认\n");
        break;
      }

      if (choice === "s") {
        console.log("  ⏭️  已跳过\n");
        break;
      }

      if (choice === "m") {
        if (mCount >= 3) {
          console.log("  ⚠️  已达 m 上限(3次)，请选 a 或 s\n");
          continue;
        }
        const angle = await readLine("      你的角度: ");
        if (!angle) { console.log("      角度不能为空\n"); continue; }
        mCount++;

        console.log(`  [Pro] 基于「${angle.slice(0, 40)}…」重读 Chunk ${current.chunkRefs.join(", ")}...`);
        const rr = await proIngest({
          source, config, client, mode: "reread",
          claim: current.claim, humanAngle: angle,
          targetChunkRefs: current.chunkRefs,
        });
        const revised = rr.propositions?.[0];

        if (!revised) {
          console.log("  ⚠️  重读失败，保留原版本\n");
          continue;
        }

        console.log("\n  🔄 原版 vs 修订版:");
        console.log(`  🤖 [原版] ${originalReading}`);
        console.log(`  🤖 [修订] ${revised.aiReading}`);
        console.log(`        (Chunk ${revised.chunkRefs.join(", ")})`);
        console.log("");

        while (true) {
          const pick = await readLine("  [a] 对齐原版  [r] 对齐修订版  [m] 再换个角度  [s] 跳过  ❯ ");
          const p = pick.toLowerCase();
          if (p === "a") {
            confirmed.push({
              propId: current.id, threadId: current.threadId,
              claim: current.claim, aiReading: originalReading,
              chunkRefs: originalChunks, revision: 0,
              status: "confirmed",
              counterIntuitive: current.counterIntuitive,
              counterIntuitiveReason: current.counterIntuitiveReason,
            });
            console.log("  ✅ 已确认（原版）\n");
            break;
          }
          if (p === "r") {
            confirmed.push({
              propId: prop.id, threadId: prop.threadId,
              claim: prop.claim, aiReading: revised.aiReading,
              chunkRefs: revised.chunkRefs, revision: current.revision + 1,
              status: "confirmed",
              counterIntuitive: prop.counterIntuitive,
              counterIntuitiveReason: prop.counterIntuitiveReason,
            });
            console.log("  ✅ 已确认（修订版）\n");
            break;
          }
          if (p === "m") {
            if (mCount >= 3) {
              console.log("  ⚠️  已达 m 上限\n");
              continue;
            }
            current = { ...revised, id: current.id, threadId: current.threadId, revision: current.revision + 1 };
            const angle2 = await readLine("      换个角度: ");
            if (!angle2) continue;
            mCount++;
            console.log(`  [Pro] 基于「${angle2.slice(0, 40)}…」重读...`);
            const rr2 = await proIngest({
              source, config, client, mode: "reread",
              claim: current.claim, humanAngle: angle2,
              targetChunkRefs: current.chunkRefs,
            });
            const revised2 = rr2.propositions?.[0];
            if (revised2) {
              current = { ...revised2, id: current.id, threadId: current.threadId, revision: current.revision + 1 };
            }
            break;
          }
          if (p === "s") {
            break;
          }
        }
        break;
      }

      console.log("      请选 a / a all / s / m\n");
    }
  }
  } // end of --auto else branch

  const toCompile = confirmed.filter((c) => c.status === "confirmed");
  if (toCompile.length === 0) {
    console.log("  无已确认条目，跳过编译\n");
    if (opts.json) printJsonResult({ ok: true, sourceId: source.id, sourceChase: null, created: [], updated: [], skipped: skippedReasons, coverage: computeCoverage(source, allProps, []) });
    return;
  }

  // ——— Phase 3: Compile ———
  console.log(`  [4] Compile — ${toCompile.length} 条已确认...\n`);

  const store = new KnowledgeStore(config);

  const existingPages = store.findRelatedPages(toCompile);
  if (existingPages.length > 0) {
    console.log(`        related: ${existingPages.length} 已有页面可能需更新`);
  }

  try {
    const cr = await proIngest({
      source, anchor: opts.anchor, config, client, mode: "compile",
      confirmedPropositionsJson: JSON.stringify(toCompile),
      existingPages,
    });

    const nodeDrafts = cr.nodeDrafts ?? [];
    const updatedPages = cr.updatedPages ?? [];
    console.log(`        pages:   ${nodeDrafts.length} new, ${updatedPages.length} updated\n`);

    const confirmedUpdates: WikiPage[] = [];
    if (updatedPages.length > 0) {
      if (opts.auto) {
        // --auto: 自动应用全部更新
        for (const up of updatedPages) {
          confirmedUpdates.push(up);
          console.log(`  ✅ auto-applied update: ${up.filePath}`);
        }
        console.log("");
      } else {
        console.log("  [5] 确认已有页面更新:\n");
        for (const up of updatedPages) {
          console.log(`  ─── 更新: ${up.filePath} ───`);
          console.log(`  📄  ${up.body.slice(0, 200)}`);
          console.log("");
          const input = await readLine("  [a] 应用更新  [s] 跳过  ❯ ");
          if (input.toLowerCase() === "a") {
            confirmedUpdates.push(up);
            console.log("  ✅ 已确认\n");
          } else {
            console.log("  ⏭️  已跳过\n");
          }
        }
      }
    }

    // ——— 收集输出（用于 --json / --dry-run） ———
    const createdPaths: string[] = nodeDrafts.map((d) => d.filePath);
    const updatedPaths: string[] = confirmedUpdates.map((p) => p.filePath);

    if (opts.dryRun) {
      // --dry-run: 只写 raw chase，不写 wiki
      console.log("  [6] Dry-run — 只保存 chase，不写 wiki...");
      store.saveRaw(source);
      const chasePath = join(config.rawDir, "chase", `${source.id.replace(/[\/:]/g, "_")}.md`);
      console.log(`        chase: ${chasePath}`);
      console.log(`        would create: ${createdPaths.length} pages`);
      console.log(`        would update: ${updatedPaths.length} pages\n`);

      if (opts.json) {
        printJsonResult({
          ok: true,
          sourceId: source.id,
          sourceChase: chasePath,
          created: createdPaths,
          updated: updatedPaths,
          skipped: skippedReasons,
          coverage: computeCoverage(source, allProps, confirmed),
        });
      } else {
        console.log("  ✅  Dry-run complete (no wiki writes)\n");
      }
      return;
    }

    console.log("  [6] Saving...");
    store.saveRaw(source);
    for (const draft of nodeDrafts) store.saveWikiNode(draft);
    for (const page of confirmedUpdates) store.saveWikiPage(page);

    const counterNode = buildCounterNode(cr, toCompile);
    if (counterNode) store.saveWikiNode(counterNode);
    if (cr.humanAnchor) {
      store.saveWikiPage({
        nodeId: cr.humanAnchor.id, filePath: `wiki/concepts/${cr.humanAnchor.id}.md`,
        frontmatter: { title: cr.humanAnchor.text.slice(0, 80), source: cr.materialId, confidence: 1.0, createdAt: new Date().toISOString() },
        body: `## Anchor\n${cr.humanAnchor.text}\n\n材料: ${cr.materialId}`,
      });
    }

    store.rebuildIndex();
    store.appendLog({
      title: cr.title, source: cr.materialId,
      anchor: opts.anchor,
      confirmed: toCompile.length, total: allProps.length,
      newPages: nodeDrafts.length, updatedPages: confirmedUpdates.length,
    });

    // ── Auto-audit: 结构 audit + 语义 audit（有 API key 时） ──
    let auditSummary: { structure: { ok: boolean; nodes: number; passed: number; failed: number }; semantic?: { ok: boolean; averageScore: number; passed: number; warning: number; failed: number } } | undefined;

    if (!opts.noAudit) {
      const structureResult = auditWiki(config);
      writeAuditResults(config, structureResult);
      auditSummary = {
        structure: {
          ok: structureResult.ok,
          nodes: structureResult.summary.nodes,
          passed: structureResult.summary.verifiedNodes,
          failed: structureResult.summary.nodes - structureResult.summary.verifiedNodes,
        },
      };

      if (config.apiKey) {
        try {
          const { DeepSeekClient } = await import("../../core/client.js");
          const auditClient = new DeepSeekClient(config);
          const semanticResult = await import("../../knowledge/semantic-audit.js").then(
            (m) => m.runSemanticAudit(config, {
              llmJudge: async (prompt: string) => auditClient.chat({
                model: config.model,
                systemPrompt: "",
                messages: [{ role: "user", content: prompt }],
              }).then((r) => r.content),
            }),
          );
          writeSemanticAuditResults(config, semanticResult);
          auditSummary.semantic = {
            ok: semanticResult.ok,
            averageScore: semanticResult.summary.averageScore,
            passed: semanticResult.summary.passed,
            warning: semanticResult.summary.warning,
            failed: semanticResult.summary.failed,
          };
          console.log(`  🔍  audit: ${semanticResult.ok ? "passed" : "issues found"} (semantic score: ${semanticResult.summary.averageScore})`);
        } catch {
          console.log("  🔍  audit: structure passed, semantic skipped (API error)");
        }
      } else {
        console.log("  🔍  audit: structure passed, semantic skipped (no API key)");
      }
    }

    const s = store.getStats();
    console.log(`\n  ✅  Done  |  sources: ${s.totalSources}  |  nodes: ${s.totalNodes}\n`);

    if (opts.json) {
      const chasePath = join(config.rawDir, "chase", `${source.id.replace(/[\/:]/g, "_")}.md`);
      printJsonResult({
        ok: true,
        sourceId: source.id,
        sourceChase: chasePath,
        created: createdPaths,
        updated: updatedPaths,
        skipped: skippedReasons,
        coverage: computeCoverage(source, allProps, confirmed),
        audit: auditSummary,
      });
    }
  } catch (err) {
    if (opts.json) {
      printJsonResult({ ok: false, sourceId: source.id, created: [], updated: [], skipped: skippedReasons, coverage: { coveredChunks: 0, totalChunks: source.chunks.length, uncoveredReasons: [(err as Error).message] } });
    } else {
      console.error(`  ❌  Compile failed: ${(err as Error).message}\n`);
    }
    process.exit(1);
  }
}

function buildCounterNode(
  compileResult: { materialId: string; title: string },
  propositions: ConfirmedProposition[],
): WikiNodeDraft | null {
  const ciList = propositions.filter((c) => c.counterIntuitive && c.status === "confirmed");
  if (ciList.length === 0) return null;

  const suffix = compileResult.materialId.slice(-8);
  const nodeId = `counter-${suffix}`;
  const chunkRefs = [...new Set(ciList.flatMap((c) => c.chunkRefs))].sort((a, b) => a - b);
  const sourceChase = `raw/chase/${compileResult.materialId.replace(/[\/:]/g, "_")}.md`;
  const evidenceSummary = ciList
    .map((c) => `${c.claim} -> ${c.counterIntuitiveReason ?? "挑战了常见认知"}`)
    .join("；");

  return {
    nodeId,
    kind: "counter",
    filePath: `wiki/counters/${nodeId}.md`,
    frontmatter: {
      nodeId,
      kind: "counter",
      title: `反直觉视角: ${compileResult.title}`,
      sourceIds: [compileResult.materialId],
      sourceChase: [sourceChase],
      chunkRefs,
      confidence: 0.55,
      status: "verified",
      tags: ["counter-intuitive"],
      related: [],
    },
    claim: `这份材料中有 ${ciList.length} 个已确认知识点挑战了常见认知。`,
    evidence: [{
      sourceId: compileResult.materialId,
      chunkRefs,
      summary: evidenceSummary,
    }],
    interpretation: ciList.map(
      (c) => `- ${c.claim}\n  - 反直觉原因: ${c.counterIntuitiveReason ?? "挑战了常见认知"}`,
    ).join("\n"),
    useFor: ["提醒 agent 在问答和启发时主动保留反直觉视角"],
    limits: ["这是由已确认 proposition 聚合出的二阶视角，不应替代原始节点的证据链"],
  };
}

// ─── --json / --dry-run helpers ────────────────────────────────────────

interface IngestJsonOutput {
  ok: boolean;
  sourceId: string;
  sourceChase?: string | null;
  created: string[];
  updated: string[];
  skipped: Array<{ propId: number; reason: string }>;
  coverage: { coveredChunks: number; totalChunks: number; uncoveredReasons: string[] };
  audit?: {
    structure: { ok: boolean; nodes: number; passed: number; failed: number };
    semantic?: { ok: boolean; averageScore: number; passed: number; warning: number; failed: number };
  };
}

function printJsonResult(out: IngestJsonOutput): void {
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

function computeCoverage(
  source: { chunks: Array<{ index: number }> },
  allProps: Array<{ chunkRefs: number[] }>,
  confirmed: Array<{ chunkRefs: number[] }>,
): { coveredChunks: number; totalChunks: number; uncoveredReasons: string[] } {
  const totalChunks = source.chunks.length;
  const covered = new Set<number>();
  for (const p of allProps) {
    for (const cr of p.chunkRefs) {
      if (cr >= 1 && cr <= totalChunks) {
        covered.add(cr);
      } else if (cr >= 0 && cr < totalChunks) {
        covered.add(cr + 1);
      }
    }
  }
  const uncovered: number[] = [];
  for (let i = 1; i <= totalChunks; i++) {
    if (!covered.has(i)) uncovered.push(i);
  }
  return {
    coveredChunks: covered.size,
    totalChunks,
    uncoveredReasons: uncovered.length > 0
      ? [`${uncovered.length} chunks not referenced by any proposition: [${uncovered.join(", ")}]`]
      : [],
  };
}

function printJsonError(error: string): void {
  process.stdout.write(JSON.stringify({
    ok: false,
    error,
    sourceId: "",
    created: [],
    updated: [],
    skipped: [],
    coverage: {
      coveredChunks: 0,
      totalChunks: 0,
      uncoveredReasons: [error],
    },
  }, null, 2) + "\n");
}
