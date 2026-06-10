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
import type { AppConfig, IngestOptions, Proposition, ConfirmedProposition, WikiPage, WikiNodeDraft } from "../../types.js";
import { auditWiki, writeAuditResults } from "../../knowledge/audit.js";
import { writeSemanticAuditResults } from "../../knowledge/semantic-audit.js";

// ─── 公共类型 ─────────────────────────────────────────────────────────

export interface IngestJsonOutput {
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

export interface IngestPipelineResult {
  ok: boolean;
  exitCode: number;
  json: IngestJsonOutput;
}

export interface RunIngestPipelineOptions extends IngestOptions {
  /** 注入 stdout（便于测试） */
  stdout?: (line: string) => void;
}

// ─── CLI 注册 ──────────────────────────────────────────────────────────

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
      const config = loadConfig();
      try {
        const result = await runIngestPipeline(config, {
          file: path,
          anchor: opts.anchor,
          mode: opts.thread || undefined,
          auto: opts.auto,
          policy: opts.policy,
          json: opts.json,
          dryRun: opts.dryRun,
          noAudit: opts.audit === false,
        });
        process.exit(result.exitCode);
      } catch (err) {
        // spec 11.3: 核心命令失败必须输出结构化 JSON
        const message = (err as Error).message;
        if (opts.json) {
          const failure = {
            ok: false,
            stage: "ingest" as const,
            error: message,
            blockingIssues: ["ingest-failed"],
            suggestedNextActions: ["check file path and format", "verify DEEPSEEK_API_KEY is set"],
          };
          console.log(JSON.stringify(failure, null, 2));
        } else {
          console.error(`  ❌  ${message}\n`);
        }
        process.exit(1);
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

/**
 * 纯函数版 ingest CLI 逻辑（便于测试）。
 *
 * 行为（与 audit/query/inspire 的纯函数入口对齐）：
 * - 接受 config（不内部 loadConfig）和可选的 client 注入
 * - 不调用 process.exit — 返回 { ok, exitCode, json }
 * - 交互式 readline 逻辑保留（只在非 --auto 模式下触发）
 */
export async function runIngestPipeline(
  config: AppConfig,
  opts: RunIngestPipelineOptions,
  client?: DeepSeekClient,
): Promise<IngestPipelineResult> {
  const out = opts.stdout ?? ((line: string) => console.log(line));

  if (!config.apiKey) {
    const json: IngestJsonOutput = {
      ok: false, sourceId: "", created: [], updated: [], skipped: [],
      coverage: { coveredChunks: 0, totalChunks: 0, uncoveredReasons: ["DEEPSEEK_API_KEY not set"] },
    };
    return { ok: false, exitCode: 1, json };
  }

  out(`\n  📥  ingesting: ${opts.file}`);
  if (opts.anchor) out(`  🎯  anchor:    "${opts.anchor}"`);
  out("");

  // ——— 加载（单文件 / TeX 文件夹）
  let sourcePath = opts.file;
  const ext = extname(opts.file).toLowerCase();
  let stat: ReturnType<typeof statSync> | undefined;

  try { stat = statSync(opts.file); } catch { /* not found, treat as file path */ }

  if (stat?.isDirectory()) {
    sourcePath = findMainTex(opts.file);
    out(`  📂  TeX project detected, main: ${sourcePath}\n`);
  }

  out("  [1] Loading source...");
  const source = stat?.isDirectory() || ext === ".tex"
    ? await loadFromTex(sourcePath, config, { chunkTokenTarget: config.chunkTokenTarget, chunkOverlapTokens: config.chunkOverlapTokens })
    : ext === ".pdf"
      ? await loadFromPdf(opts.file, { chunkTokenTarget: config.chunkTokenTarget, chunkOverlapTokens: config.chunkOverlapTokens, config })
      : loadFromFile(opts.file, { chunkTokenTarget: config.chunkTokenTarget, chunkOverlapTokens: config.chunkOverlapTokens });
  out(`        title:   ${source.title}\n        chunks:  ${source.chunks.length}\n        tokens:  ~${source.totalTokens}\n`);

  const dsClient = client ?? new DeepSeekClient(config);

  // ——— Phase 1: Extract ———
  out("  [2] Extract — Pro 初读...\n");
  let br: Awaited<ReturnType<typeof proIngest>>;
  try {
    br = await proIngest({ source, anchor: opts.anchor, config, client: dsClient, mode: "extract" });
  } catch (err) {
    const message = `Extract failed: ${(err as Error).message}`;
    const json: IngestJsonOutput = {
      ok: false, sourceId: source.id, created: [], updated: [], skipped: [],
      coverage: { coveredChunks: 0, totalChunks: source.chunks.length, uncoveredReasons: [message] },
    };
    return { ok: false, exitCode: 1, json };
  }

  const threads = br.mainThreads ?? [];
  const allProps = br.propositions ?? [];

  if (threads.length === 0 || allProps.length === 0) {
    out("  ⚠️  未生成内容，跳过\n");
    const json: IngestJsonOutput = { ok: true, sourceId: source.id, created: [], updated: [], skipped: [], coverage: computeCoverage(source, allProps, []) };
    return { ok: true, exitCode: 0, json };
  }

  // ——— 主线选择（支持 --thread 跳过） ———
  let selectedId = 0;
  const threadOpt = opts.mode; // --thread 值传入 mode

  if (opts.auto && !threadOpt) {
    selectedId = 0;
    out(`  📋 ${threads.length} 条主线（--auto 全选）\n`);
  } else if (source.chunks.length < 5 || threadOpt === "all") {
    selectedId = 0;
    const label = source.chunks.length < 5 ? "短文档，自动全部" : "--thread all";
    out(`  📋 ${threads.length} 条主线（${label}）\n`);
  } else if (threadOpt) {
    const n = Number(threadOpt);
    if (threads.some((t) => t.id === n)) {
      selectedId = n;
      out(`  📋 主线 [${n}]: ${threads.find((t) => t.id === n)?.title}\n`);
    } else {
      const json: IngestJsonOutput = {
        ok: false, sourceId: source.id, created: [], updated: [], skipped: [],
        coverage: { coveredChunks: 0, totalChunks: source.chunks.length, uncoveredReasons: [`--thread ${threadOpt} invalid`] },
      };
      return { ok: false, exitCode: 1, json };
    }
  } else {
    out(`  📋 ${threads.length} 条主线:\n`);
    for (const t of threads) {
      out(`  [${t.id}] ${t.title}`);
      out(`      ${t.description}\n`);
    }
    while (true) {
      const input = await readLine("  ❯ 选主线编号（回车=全部）: ");
      if (!input) { selectedId = 0; break; }
      const n = Number(input);
      if (threads.some((t) => t.id === n)) { selectedId = n; break; }
      out(`      输入 ${threads.map((t) => t.id).join("/")}`);
    }
  }

  const targetProps = selectedId === 0
    ? allProps
    : allProps.filter((p) => p.threadId === selectedId);

  if (targetProps.length === 0) {
    out("  该主线下无 proposition\n");
    const json: IngestJsonOutput = { ok: true, sourceId: source.id, created: [], updated: [], skipped: [], coverage: computeCoverage(source, allProps, []) };
    return { ok: true, exitCode: 0, json };
  }

  out(`\n  [3] 逐条确认 — ${targetProps.length} 条 proposition\n`);

  // ——— Phase 2: 逐条确认 ———
  const confirmed: ConfirmedProposition[] = [];
  const skippedReasons: Array<{ propId: number; reason: string }> = [];

  if (opts.auto) {
    // ── --auto 模式：filterByPolicy 自动确认 ──
    const policy = (opts.policy as Policy) ?? "balanced";
    out(`        policy: ${policy}\n`);

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
        out(`  ✅ [${prop.id}] auto-confirmed (${prop.kind ?? "?"} conf=${(prop.confidence ?? 0).toFixed(2)})`);
      } else {
        skippedReasons.push({ propId: prop.id, reason: result.reason ?? "unknown" });
        out(`  ⏭️  [${prop.id}] skipped: ${result.reason}`);
      }
    }
    out(`\n  => ${confirmed.length} confirmed, ${skippedReasons.length} skipped\n`);
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
      out(`  ─── [${current.id}/${targetProps.length}]${revTag}  (剩余 ${remainCount}) ───`);
      out(`  📄  ${current.claim}`);
      out(`  🤖  ${current.aiReading}`);
      out(`      (Chunk ${current.chunkRefs.join(", ")})`);
      if (current.counterIntuitive && current.counterIntuitiveReason) {
        out(`  ⚡ 反直觉: ${current.counterIntuitiveReason}`);
      }
      out("");

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
        out("  ✅ 已确认");
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
          out(`  ✅ [${rest.id}] 批量确认`);
        }
        out("");
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
        out("  ✅ 已确认\n");
        break;
      }

      if (choice === "s") {
        out("  ⏭️  已跳过\n");
        break;
      }

      if (choice === "m") {
        if (mCount >= 3) {
          out("  ⚠️  已达 m 上限(3次)，请选 a 或 s\n");
          continue;
        }
        const angle = await readLine("      你的角度: ");
        if (!angle) { out("      角度不能为空\n"); continue; }
        mCount++;

        out(`  [Pro] 基于「${angle.slice(0, 40)}…」重读 Chunk ${current.chunkRefs.join(", ")}...`);
        const rr = await proIngest({
          source, config, client: dsClient, mode: "reread",
          claim: current.claim, humanAngle: angle,
          targetChunkRefs: current.chunkRefs,
        });
        const revised = rr.propositions?.[0];

        if (!revised) {
          out("  ⚠️  重读失败，保留原版本\n");
          continue;
        }

        out("\n  🔄 原版 vs 修订版:");
        out(`  🤖 [原版] ${originalReading}`);
        out(`  🤖 [修订] ${revised.aiReading}`);
        out(`        (Chunk ${revised.chunkRefs.join(", ")})`);
        out("");

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
            out("  ✅ 已确认（原版）\n");
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
            out("  ✅ 已确认（修订版）\n");
            break;
          }
          if (p === "m") {
            if (mCount >= 3) {
              out("  ⚠️  已达 m 上限\n");
              continue;
            }
            current = { ...revised, id: current.id, threadId: current.threadId, revision: current.revision + 1 };
            const angle2 = await readLine("      换个角度: ");
            if (!angle2) continue;
            mCount++;
            out(`  [Pro] 基于「${angle2.slice(0, 40)}…」重读...`);
            const rr2 = await proIngest({
              source, config, client: dsClient, mode: "reread",
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

      out("      请选 a / a all / s / m\n");
    }
  }
  } // end of --auto else branch

  const toCompile = confirmed.filter((c) => c.status === "confirmed");
  if (toCompile.length === 0) {
    out("  无已确认条目，跳过编译\n");
    const json: IngestJsonOutput = { ok: true, sourceId: source.id, sourceChase: null, created: [], updated: [], skipped: skippedReasons, coverage: computeCoverage(source, allProps, []) };
    return { ok: true, exitCode: 0, json };
  }

  // ——— Phase 3: Compile ———
  out(`  [4] Compile — ${toCompile.length} 条已确认...\n`);

  const store = new KnowledgeStore(config);

  const existingPages = store.findRelatedPages(toCompile);
  if (existingPages.length > 0) {
    out(`        related: ${existingPages.length} 已有页面可能需更新`);
  }

  try {
    const cr = await proIngest({
      source, anchor: opts.anchor, config, client: dsClient, mode: "compile",
      confirmedPropositionsJson: JSON.stringify(toCompile),
      existingPages,
    });

    const nodeDrafts = cr.nodeDrafts ?? [];
    const updatedPages = cr.updatedPages ?? [];
    out(`        pages:   ${nodeDrafts.length} new, ${updatedPages.length} updated\n`);

    const confirmedUpdates: WikiPage[] = [];
    if (updatedPages.length > 0) {
      if (opts.auto) {
        for (const up of updatedPages) {
          confirmedUpdates.push(up);
          out(`  ✅ auto-applied update: ${up.filePath}`);
        }
        out("");
      } else {
        out("  [5] 确认已有页面更新:\n");
        for (const up of updatedPages) {
          out(`  ─── 更新: ${up.filePath} ───`);
          out(`  📄  ${up.body.slice(0, 200)}`);
          out("");
          const input = await readLine("  [a] 应用更新  [s] 跳过  ❯ ");
          if (input.toLowerCase() === "a") {
            confirmedUpdates.push(up);
            out("  ✅ 已确认\n");
          } else {
            out("  ⏭️  已跳过\n");
          }
        }
      }
    }

    // ——— 收集输出（用于 --json / --dry-run） ———
    const createdPaths: string[] = nodeDrafts.map((d) => d.filePath);
    const updatedPaths: string[] = confirmedUpdates.map((p) => p.filePath);

    if (opts.dryRun) {
      out("  [6] Dry-run — 只保存 chase，不写 wiki...");
      store.saveRaw(source);
      const chasePath = join(config.rawDir, "chase", `${source.id.replace(/[\/:]/g, "_")}.md`);
      out(`        chase: ${chasePath}`);
      out(`        would create: ${createdPaths.length} pages`);
      out(`        would update: ${updatedPaths.length} pages\n`);

      const json: IngestJsonOutput = {
        ok: true, sourceId: source.id, sourceChase: chasePath,
        created: createdPaths, updated: updatedPaths, skipped: skippedReasons,
        coverage: computeCoverage(source, allProps, confirmed),
      };
      return { ok: true, exitCode: 0, json };
    }

    out("  [6] Saving...");
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
    let auditSummary: IngestJsonOutput["audit"] | undefined;

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
          const auditClient = client ?? new DeepSeekClient(config);
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
          out(`  🔍  audit: ${semanticResult.ok ? "passed" : "issues found"} (semantic score: ${semanticResult.summary.averageScore})`);
        } catch (semanticErr) {
          // spec 11.3: 语义 audit 失败不阻止 ingest 整体成功，但记录错误
          const semanticMessage = (semanticErr as Error).message;
          out(`  🔍  audit: structure passed, semantic skipped (API error: ${semanticMessage.slice(0, 80)})`);
          auditSummary.semantic = {
            ok: false,
            averageScore: 0,
            passed: 0,
            warning: 0,
            failed: 0,
          };
        }
      } else {
        out("  🔍  audit: structure passed, semantic skipped (no API key)");
      }
    }

    const s = store.getStats();
    out(`\n  ✅  Done  |  sources: ${s.totalSources}  |  nodes: ${s.totalNodes}\n`);

    const chasePath = join(config.rawDir, "chase", `${source.id.replace(/[\/:]/g, "_")}.md`);
    const json: IngestJsonOutput = {
      ok: true, sourceId: source.id, sourceChase: chasePath,
      created: createdPaths, updated: updatedPaths, skipped: skippedReasons,
      coverage: computeCoverage(source, allProps, confirmed),
      audit: auditSummary,
    };
    return { ok: true, exitCode: 0, json };
  } catch (err) {
    const json: IngestJsonOutput = {
      ok: false, sourceId: source.id, created: [], updated: [], skipped: skippedReasons,
      coverage: { coveredChunks: 0, totalChunks: source.chunks.length, uncoveredReasons: [(err as Error).message] },
    };
    return { ok: false, exitCode: 1, json };
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

// ─── Coverage helper ─────────────────────────────────────────────────

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
