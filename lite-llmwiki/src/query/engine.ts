/**
 * query — evidence-aware knowledge query engine (v6)
 *
 * 流程（plan 9.3-9.6）：
 *  1. 调 buildQueryBoard 装配确定性 board（不调 LLM）
 *  2. 如有 llmCaller，调 LLM 拿 answer
 *  3. 无 llmCaller → board-only 模式：answer 标注 "no API key / board-only"
 *  4. 输出分层：fromWiki / modelSynthesis / missingEvidence / suggestedNextActions
 *  5. 返回 QueryResultV6 shape
 *
 * llmCaller 注入便于测试（生产环境 = DeepSeekClient.chat）。
 */
import { buildQueryBoard, type BuildQueryBoardOptions } from "./board.js";
import type {
  AppConfig,
  BoardMode,
  MissingEvidence,
  ModelSynthesis,
  QueryBoard,
  QueryBoardSummary,
  QueryResultV6,
  SuggestedNextAction,
  Usage,
  WikiClaimRef,
} from "../types.js";
import { normalizeBoardMode } from "../types.js";

// ─── 导出类型 ────────────────────────────────────────────────────────

export interface QueryKnowledgeOptions extends BuildQueryBoardOptions {
  question: string;
  config: AppConfig;
  signal?: AbortSignal;
  /**
   * 注入 LLM caller（生产环境 = DeepSeekClient.chat，测试可 mock）。
   * 不传时进入 board-only 模式。
   */
  llmCaller?: (
    board: QueryBoard,
    question: string,
  ) => Promise<{ answer: string; usage?: Usage | null; modelSynthesis?: ModelSynthesis[] }>;
}

export type QueryResult = QueryResultV6;

// ─── 主入口 ──────────────────────────────────────────────────────────

export async function queryKnowledge(
  opts: QueryKnowledgeOptions,
): Promise<QueryResultV6> {
  const mode = normalizeBoardMode(opts.mode as BoardMode | string);
  const question = opts.question;

  // ── 1. 装配 board ──
  const board = await buildQueryBoard(opts.config, question, {
    mode: opts.mode,
    maxNodes: opts.maxNodes,
    includeLegacy: opts.includeLegacy,
    nodeId: opts.nodeId,
    source: opts.source,
    tags: opts.tags,
    withSource: opts.withSource,
  });

  // ── 2. 调 LLM（如有）或 board-only 模式 ──
  let answer: string;
  let modelSynthesis: ModelSynthesis[] = [];
  let usage: Usage | null = null;

  if (opts.llmCaller) {
    const r = await opts.llmCaller(board, question);
    answer = r.answer;
    modelSynthesis = r.modelSynthesis ?? [];
    usage = r.usage ?? null;
  } else {
    answer = board.seedNodes.length > 0
      ? "(board-only mode: no LLM caller / API key; the deterministic board is the context above)"
      : "(board-only mode: no LLM caller / API key; no wiki nodes match this question)";
  }

  // ── 3. 输出分层 ──
  const fromWiki = buildFromWiki(board);
  const missingEvidence = buildMissingEvidence(board, question);
  const suggestedNextActions = buildSuggestedNextActions(board, missingEvidence, mode);

  // ── 4. 摘要 ──
  const boardSummary = summarizeBoard(board);

  return {
    ok: true,
    mode: board.mode,
    question: board.question,
    answer,
    fromWiki,
    modelSynthesis,
    missingEvidence,
    suggestedNextActions,
    board,
    boardSummary,
    usage,
  };
}

// ─── 分层构造 ──────────────────────────────────────────────────────

function buildFromWiki(board: QueryBoard): WikiClaimRef[] {
  return board.seedNodes.map((n) => ({
    claim: n.claim,
    nodeId: n.nodeId,
    filePath: n.filePath,
    chunkRefs: n.chunkRefs,
    boardRole: n.boardRoles?.[0],
  }));
}

function buildMissingEvidence(board: QueryBoard, question: string): MissingEvidence[] {
  const items: MissingEvidence[] = [];
  for (const gap of board.gaps) {
    items.push({ question: gap.question, reason: gap.reason });
  }
  if (board.seedNodes.length === 0 && items.length === 0) {
    items.push({ question, reason: "no wiki node covers this question" });
  }
  return items;
}

function buildSuggestedNextActions(
  board: QueryBoard,
  missing: MissingEvidence[],
  mode: BoardMode,
): SuggestedNextAction[] {
  const actions: SuggestedNextAction[] = [];

  if (board.seedNodes.length === 0) {
    actions.push({
      action: "ingest more material",
      reason: "no wiki node covers this question — add raw material and re-compile",
    });
    return actions;
  }

  if (missing.length > 0) {
    actions.push({
      action: "expand the wiki",
      reason: `${missing.length} aspect(s) of the question lack wiki coverage`,
    });
  }

  if (mode === "ask" || mode === "trace") {
    actions.push({
      action: "run semantic audit",
      reason: "verify the wiki claims are faithful to chase before relying on them",
    });
  }

  if (board.gaps.length > 0) {
    actions.push({
      action: "investigate gaps",
      reason: "board has open questions that need research",
    });
  }

  return actions;
}

function summarizeBoard(board: QueryBoard): QueryBoardSummary {
  return {
    mode: board.mode,
    question: board.question,
    seedCount: board.seedNodes.length,
    evidenceCount: board.evidenceNodes.length,
    relatedCount: board.relatedNodes.length,
    limitCount: board.limitNodes.length,
    counterCount: board.counterNodes.length,
    questionCount: board.questionNodes.length,
    sourceExcerptCount: board.sourceExcerpts.length,
    gapCount: board.gaps.length,
    seedNodeIds: board.seedNodes.map((n) => n.nodeId),
  };
}

// ─── Prompt 构造（生产环境用，测试不依赖） ─────────────────────────

const QUERY_SYSTEM_PROMPT = `你是 lite-llmwiki 的 v6 board-driven 知识查询助手。

## 局面说明（来自 board.instructions）

你的工作是基于用户已编译的 board 局面回答问题。Board 已经被确定性装配好（buildQueryBoard），按你当前的 mode 组装。

## 输出规则（spec 12.3）

1. **不要把 wiki 内容伪装成自己的综合**。引用的每条事实都要回到 board.seedNodes 的具体 claim。
2. **fromWiki / modelSynthesis / missingEvidence 三段必须清晰分开**。
3. **可自由综合，但综合必须标 basedOn: [nodeId 列表]**。
4. **wiki 不足时，明确 missingEvidence**。
5. **回答用中文。**`;

export { QUERY_SYSTEM_PROMPT };

/**
 * 工厂：从 engine 配置生成 LLM caller（生产用）。
 * 由 cli 包装层调，不在这里直接调以保持 engine 可注入测试。
 */
export function makeDeepSeekCaller(config: AppConfig, signal?: AbortSignal) {
  return async (_board: QueryBoard, question: string) => {
    const { DeepSeekClient } = await import("../core/client.js");
    const client = new DeepSeekClient(config);
    const result = await client.chat({
      model: config.model,
      systemPrompt: QUERY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: question }],
      signal,
    });
    return {
      answer: result.content,
      usage: result.usage
        ? { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens }
        : null,
    };
  };
}
