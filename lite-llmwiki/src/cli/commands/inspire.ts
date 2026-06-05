import type { Command } from "commander";
import { loadConfig } from "../../config.js";
import { buildQueryBoard, type BuildQueryBoardOptions } from "../../query/board.js";
import { inspireWiki } from "../../query/inspire.js";
import type {
  AppConfig,
  BoardNode,
  QueryBoard,
  WikiKind,
} from "../../types.js";

// ─── 公共类型 ────────────────────────────────────────────────────────

export interface InspireItem {
  type: "connection" | "hypothesis" | "question" | "action" | "missingEvidence";
  text: string;
  /** 锚定的 wiki 节点（spec 10.3 basedOn） */
  basedOn: string[];
  /** 模型自评置信度 */
  confidence?: "low" | "medium" | "high";
  /** spec 10.3 显式标注 "这是综合，不是事实" */
  evidenceBoundary?: string;
}

export interface InspireAnchor {
  nodeId: string;
  kind: WikiKind | string;
  title: string;
  filePath: string;
  claim: string;
  text?: string; // 纯文本 seed 时无 nodeId
}

export interface InspireResult {
  ok: boolean;
  mode: "inspire";
  seed: InspireAnchor | null;
  connections: InspireItem[];
  hypotheses: InspireItem[];
  questions: InspireItem[];
  actions: InspireItem[];
  missingEvidence: InspireItem[];
  anchors: InspireAnchor[];
}

export interface RunInspireCliOptions {
  mode?: string;
  /** 文本 seed（无 nodeId 锚定时） */
  seed?: string;
  /** 强制某 node 作为 anchor */
  node?: string;
  /** 按 source 过滤 anchors */
  source?: string;
  /** 按 kind 过滤 */
  kind?: string;
  /** 按 tags 过滤 */
  tags?: string[];
  /** 注入 LLM caller（生产可接 DeepSeek） */
  llmCaller?: (board: QueryBoard) => Promise<string | InspireItem[]>;
  json?: boolean;
  stdout?: (line: string) => void;
}

/**
 * 纯函数版 inspire CLI 逻辑（便于测试）。
 *
 * 装配顺序：
 * 1. 选 anchor（--node 优先 → --seed 文本 → 随机）
 * 2. 用 buildQueryBoard 装配 "inspire" 模式的 board（heuristic 弱连接）
 * 3. 调 LLM caller（如果有）生成 connections/hypotheses/questions
 * 4. 无 LLM caller → board-only 启发（基于 board 的相关节点 / gaps / counters）
 * 5. 输出 JSON
 */
export async function runInspireCli(
  config: AppConfig,
  options: RunInspireCliOptions = {},
): Promise<InspireResult> {
  const out = options.stdout ?? ((line: string) => console.log(line));

  // ── 1. 选 anchor ──
  let anchor: InspireAnchor | null = null;
  if (options.node) {
    // --node：定位指定节点
    const board = await buildQueryBoard(config, options.seed ?? "", {
      mode: "inspire",
      nodeId: options.node,
    });
    const found = board.seedNodes.find((n) => n.nodeId === options.node);
    if (found) anchor = nodeToAnchor(found);
  }
  if (!anchor && options.seed) {
    // --seed 文本：用 board 搜索相关 node 作为 anchor
    const board = await buildQueryBoard(config, options.seed, {
      mode: "inspire",
    });
    const found = board.seedNodes[0];
    if (found) {
      anchor = {
        ...nodeToAnchor(found),
        text: options.seed, // 保留原始 seed 文本
      };
    } else {
      // 无匹配 node：纯文本 anchor
      anchor = { nodeId: "", kind: "seed", title: options.seed, filePath: "", claim: "", text: options.seed };
    }
  }
  if (!anchor) {
    // fallback：随机抽一个 node
    const sample = inspireWiki(config, {
      kind: options.kind,
      tags: options.tags,
    });
    if (sample) {
      anchor = {
        nodeId: sample.nodeId,
        kind: sample.kind,
        title: sample.title,
        filePath: sample.filePath,
        claim: sample.claim,
      };
    }
  }

  // ── 2. 装配 board（heuristic 弱连接）──
  const board = await buildQueryBoard(config, anchor?.title ?? options.seed ?? "", {
    mode: "inspire",
    nodeId: anchor?.nodeId || undefined,
    source: options.source,
    tags: options.tags,
  });

  // ── 3. 过滤 anchors（按 kind / source）──
  let anchors: InspireAnchor[] = board.relatedNodes.map(nodeToAnchor);
  if (anchor) anchors = [anchor, ...anchors];
  if (options.kind) anchors = anchors.filter((a) => a.kind === options.kind);
  if (options.source) anchors = anchors.filter((a) => a.filePath.includes(options.source!));

  // ── 4. 调 LLM（heuristic fallback）──
  const connections: InspireItem[] = [];
  const hypotheses: InspireItem[] = [];
  const questions: InspireItem[] = [];
  const actions: InspireItem[] = [];
  const missingEvidence: InspireItem[] = [];

  if (options.llmCaller) {
    const r = await options.llmCaller(board);
    const items: InspireItem[] = typeof r === "string" ? parseInspireItems(r) : r;
    for (const it of items) {
      switch (it.type) {
        case "connection": connections.push(it); break;
        case "hypothesis": hypotheses.push(it); break;
        case "question": questions.push(it); break;
        case "action": actions.push(it); break;
        case "missingEvidence": missingEvidence.push(it); break;
      }
    }
  } else {
    // board-only heuristic（spec 10.5）
    for (const related of board.relatedNodes.slice(0, 3)) {
      connections.push({
        type: "connection",
        text: `${anchor?.title ?? "this"} 与 ${related.title} 共享 wiki 上下文`,
        basedOn: [anchor?.nodeId ?? "", related.nodeId].filter(Boolean),
        confidence: "medium",
        evidenceBoundary: "这是 board 自动基于 tag/source 共享的连接，不是 LLM 综合",
      });
    }
    for (const counter of board.counterNodes.slice(0, 2)) {
      questions.push({
        type: "question",
        text: `${counter.title} 是否挑战 ${anchor?.title ?? "this"}？`,
        basedOn: [counter.nodeId],
        confidence: "low",
        evidenceBoundary: "heuristic: counter kind 的节点",
      });
    }
    for (const gap of board.gaps) {
      missingEvidence.push({
        type: "missingEvidence",
        text: gap.reason,
        basedOn: [],
        confidence: "high",
        evidenceBoundary: "wiki 没有覆盖此面",
      });
    }
  }

  const result: InspireResult = {
    ok: true,
    mode: "inspire",
    seed: anchor,
    connections,
    hypotheses,
    questions,
    actions,
    missingEvidence,
    anchors,
  };

  // ── 5. JSON 输出 ──
  if (options.json) {
    out(JSON.stringify(result, null, 2));
  }

  return result;
}

function nodeToAnchor(n: BoardNode): InspireAnchor {
  return {
    nodeId: n.nodeId,
    kind: n.kind,
    title: n.title,
    filePath: n.filePath,
    claim: n.claim,
    text: n.title,
  };
}

/** 解析 LLM 返回的 JSON 字符串为 InspireItem 列表 */
function parseInspireItems(text: string): InspireItem[] {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const json = fenced ? fenced[1]!.trim() : trimmed;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: InspireItem[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const type = o.type as InspireItem["type"];
    if (!["connection", "hypothesis", "question", "action", "missingEvidence"].includes(type)) continue;
    out.push({
      type,
      text: String(o.text ?? ""),
      basedOn: Array.isArray(o.basedOn) ? o.basedOn.map((x) => String(x)) : [],
      confidence: o.confidence as InspireItem["confidence"],
      evidenceBoundary: o.evidenceBoundary as string | undefined,
    });
  }
  return out;
}

export function registerInspireCommand(program: Command): void {
  program
    .command("inspire")
    .description("Generate inspiration from wiki (board-driven, v6)")
    .option("-j, --json", "output JSON")
    .option("-s, --seed <text>", "seed text for inspiration")
    .option("-n, --node <nodeId>", "force a specific node as anchor")
    .option("--source <sourceId>", "filter anchors by source")
    .option("-k, --kind <kind>", "filter by kind (concept, claim, insight, method, etc.)")
    .option("-t, --tags <tags>", "filter by tags (comma-separated, any match)")
    .action(async (options: RunInspireCliOptions) => {
      const config = loadConfig();
      const rawTags = (options as { tags?: unknown }).tags;
      const tags = typeof rawTags === "string"
        ? rawTags.split(",").map((t: string) => t.trim()).filter(Boolean)
        : Array.isArray(rawTags) ? (rawTags as string[]) : undefined;
      const result = await runInspireCli(config, {
        ...options,
        tags,
        json: options.json ?? false,
      });
      if (options.json) return;

      // ── Human-readable output ──
      if (!result.seed && result.missingEvidence.length === 0) {
        console.log("");
        console.log("  ✨  No inspiration found — the wiki is empty or no matching pages.");
        console.log("");
        return;
      }
      console.log("");
      if (result.seed) {
        console.log(`  ✨  Inspire anchor: ${result.seed.title ?? result.seed.text}`);
        if (result.seed.filePath) console.log(`     ${result.seed.kind} · ${result.seed.filePath}`);
      }
      if (result.connections.length > 0) {
        console.log("");
        console.log(`  Connections (${result.connections.length}):`);
        for (const c of result.connections) console.log(`    • ${c.text}`);
      }
      if (result.hypotheses.length > 0) {
        console.log("");
        console.log(`  Hypotheses (${result.hypotheses.length}):`);
        for (const h of result.hypotheses) console.log(`    • ${h.text}`);
      }
      if (result.questions.length > 0) {
        console.log("");
        console.log(`  Questions (${result.questions.length}):`);
        for (const q of result.questions) console.log(`    • ${q.text}`);
      }
      if (result.missingEvidence.length > 0) {
        console.log("");
        console.log(`  Missing evidence (${result.missingEvidence.length}):`);
        for (const m of result.missingEvidence) console.log(`    • ${m.text}`);
      }
      console.log("");
    });
}

// 保留旧 BuildQueryBoardOptions 的引用以避免未使用导入告警
export type { BuildQueryBoardOptions };
