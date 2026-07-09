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
/**
 * query — evidence-aware knowledge query engine (v6)
 *
 * 流程（plan 9.3-9.6）：
 *  1. 调 buildQueryBoard 装配确定性 board（不调 LLM）
 *  2. 调 LLM 拿 answer（llmCaller 必须提供，本产品必须有 API key）
 *  3. 输出分层：fromWiki / modelSynthesis / missingEvidence / suggestedNextActions
 *  4. 返回 QueryResultV6 shape
 *
 * llmCaller 注入便于测试（生产环境 = DeepSeekClient.chat）。
 */
import { type BuildQueryBoardOptions, buildQueryBoard } from "./board.js";

// ─── 导出类型 ────────────────────────────────────────────────────────

export interface QueryKnowledgeOptions extends BuildQueryBoardOptions {
	question: string;
	config: AppConfig;
	signal?: AbortSignal;
	/**
	 * 注入 LLM caller（生产环境 = DeepSeekClient.chat，测试可 mock）。
	 * 必须提供 — 本产品不运行在无 API key 的模式下。
	 */
	llmCaller: (
		board: QueryBoard,
		question: string,
	) => Promise<{
		answer: string;
		usage?: Usage | null;
		modelSynthesis?: ModelSynthesis[];
	}>;
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
		includeFailed: opts.includeFailed,
		nodeId: opts.nodeId,
		source: opts.source,
		tags: opts.tags,
		withSource: opts.withSource,
	});

	// ── 2. 调 LLM ──
	const r = await opts.llmCaller(board, question);
	const answer = r.answer;
	const modelSynthesis: ModelSynthesis[] = r.modelSynthesis ?? [];
	const usage: Usage | null = r.usage ?? null;

	// ── 3. 输出分层 ──
	const fromWiki = buildFromWiki(board);
	const missingEvidence = buildMissingEvidence(board, question);
	const suggestedNextActions = buildSuggestedNextActions(
		board,
		missingEvidence,
		mode,
	);

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
		propRefs: n.propRefs,
		boardRole: n.boardRoles?.[0],
	}));
}

function buildMissingEvidence(
	board: QueryBoard,
	question: string,
): MissingEvidence[] {
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
			reason:
				"no wiki node covers this question — add raw material and re-compile",
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
			reason:
				"verify the wiki claims are faithful to chase before relying on them",
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

用户消息中会包含 board 的结构化内容（种子节点、证据、反直觉视角、局限等）。
你必须基于这些 board 内容来回答，而不是凭自己的训练数据推断。

## 输出规则（spec 12.3）

1. **引用的每条事实必须回到 board 中具体节点的 claim**，格式: [nodeId]。
2. **可自由综合**，但综合必须基于 board 中的节点，不能编造 board 中不存在的内容。
3. **board 不足以回答时，明确说明缺少什么**，而不是猜测。
4. **回答用中文。**`;

export { QUERY_SYSTEM_PROMPT };

/**
 * inspire 专用系统 prompt（spec 8.8 / 10.3）。
 *
 * 与 QUERY_SYSTEM_PROMPT 的区别：
 * - 要求输出 JSON 数组（5 种启发项类型），而非自然语言回答
 * - 每条启发项必须标明 basedOn（锚定的 wiki 节点）和 confidence
 * - 强调"这是启发，不是事实"的证据边界标注
 */
const INSPIRE_SYSTEM_PROMPT = `你是 lite-llmwiki 的 v6 board-driven 启发生成助手。

## 核心理念

Wiki 为你提供"棋盘"——已有的知识结构、节点关系、证据链、反直觉视角和局限。
你的任务是理解这个局面，然后**自由探索**可能的连接、假设和问题。

## 你的任务

基于用户提供的 board 局面，生成启发项（connections, hypotheses, questions, actions, missingEvidence）。

board 中包含：
- 种子节点：用户关注的核心概念
- 证据节点：支撑这些概念的原始材料
- 反直觉节点：挑战常规认知的视角
- 局限节点：已知知识的边界
- 知识缺口：尚未覆盖的领域

你应该：
1. **理解局面**：仔细阅读 board 中的所有节点，理解用户的知识结构
2. **发现张力**：寻找节点之间的矛盾、互补或空白
3. **自由探索**：基于这个局面，提出新的连接、假设和问题
4. **标注依据**：每条启发项说明它基于哪些 wiki 节点（basedOn）

## 输出格式

你必须返回一个 JSON 数组，每条启发项的格式如下：

[
  {
    "type": "connection",         // 或 "hypothesis" / "question" / "action" / "missingEvidence"
    "text": "启发描述（中文）",
    "basedOn": ["nodeId1", "nodeId2"],  // 锚定的 wiki 节点 ID（必须来自 board）
    "confidence": "medium",       // "low" / "medium" / "high"
    "evidenceBoundary": "证据边界说明"  // 标注"这是综合，不是事实"
  }
]

## 五种启发项类型

- **connection**: 发现两个节点之间的隐藏关联（跨领域、跨 tag、跨 source）
- **hypothesis**: 基于 board 张力提出的假设（如 audit 失败的节点暗示什么）
- **question**: board 中值得进一步探索的问题（如 counter 节点质疑什么）
- **action**: 建议下一步行动（如补充 chase、重新审查 evidence）
- **missingEvidence**: board 中缺失的证据或视角

## 规则

1. 每条启发项的 basedOn 必须引用 board 中实际存在的 nodeId，不能编造。
2. 至少生成 2 条 connection 和 1 条 question。
3. 对综合推断标注 evidenceBoundary: "这是综合推断，不是直接事实"。
4. 对 board 不覆盖的领域，标注为 missingEvidence。
5. **鼓励创新**：不要局限于 board 中已有的内容，要提出新的视角。
6. 用中文写 text 字段。`;

/**
 * Audit 系统提示词：语义审计专家的角色定义和行为规范
 */
const AUDIT_SYSTEM_PROMPT = `你是 lite-llmwiki 的语义审计专家。

## 你的职责

审查 wiki 节点的语义忠实度，判断 wiki 内容是否忠实地反映了原始材料（chase excerpts）。

**重要原则**：
- 你只评估 wiki 是否忠实于原始材料，不评估原始材料本身是否正确
- 如果原始材料有误，但 wiki 如实反映了它，这不算问题
- 如果 wiki 添加了原始材料没有的内容，或者扭曲了原意，这才是问题

## 审查维度

对于每个 wiki 节点，从以下 5 个维度进行审查：

1. **support（支持度）**
   - aligned: claim 完全被 evidence 支持
   - stretched: claim 有一定支持但存在过度解读
   - unsupported: claim 缺乏证据支持或与证据矛盾

2. **addition（新增内容）**
   - none: 没有添加原文没有的主张
   - minor: 有少量合理的推断或解释
   - major: 添加了原文没有的重要主张

3. **inference（推理标注）**
   - ok: 推理正确标注为推理而非事实
   - warning: 部分推理未明确标注
   - failed: 把推理当作事实陈述

4. **limits（限制条件）**
   - ok: 重要限制条件都被保留在 Limits section
   - warning: 遗漏了部分限制条件
   - failed: 遗漏了关键限制条件导致误导

5. **citation（引用完整性）**
   - ok: chunkRefs 覆盖了关键证据
   - warning: chunkRefs 不完整但不影响理解
   - failed: chunkRefs 严重缺失，无法验证来源

## 输出要求

你必须返回严格的 JSON 格式，不要任何 prose 或 markdown fence。

输出格式：
{
  "verdict": "passed" | "warning" | "failed",
  "score": <number 0.0-1.0>,
  "support": "aligned" | "stretched" | "unsupported",
  "addition": "none" | "minor" | "major",
  "inference": "ok" | "warning" | "failed",
  "limits": "ok" | "warning" | "failed",
  "citation": "ok" | "warning" | "failed",
  "issues": [<one short string per problem, in any dimension>]
}

## 判定标准

- **passed**: 所有维度都正常，无 issues
- **warning**: 存在 minor 问题，但不影响整体可靠性
- **failed**: 存在严重问题，wiki 扭曲了原始材料

## 评分指南

- 0.9-1.0: passed，完全忠实
- 0.7-0.9: warning，有小问题但可接受
- 0.0-0.7: failed，有严重问题

请严格遵循以上规范进行审计。`;

export { INSPIRE_SYSTEM_PROMPT, AUDIT_SYSTEM_PROMPT };

/**
 * 工厂：从 engine 配置生成 LLM caller（生产用）。
 * 由 cli 包装层调，不在这里直接调以保持 engine 可注入测试。
 *
 * v6 fix: board 内容不再被忽略，序列化为结构化文本拼入 user message，
 * 让 LLM 能看到 wiki 里有什么节点、claim、evidence、limits 等，
 * 从而基于 board 回答而非无根推断。
 *
 * @param systemPrompt 自定义系统 prompt（默认用 QUERY_SYSTEM_PROMPT）
 * @param responseFormat 响应格式（"json_object" 强制 JSON 输出）
 */
export function makeDeepSeekCaller(
	config: AppConfig,
	signal?: AbortSignal,
	options?: {
		systemPrompt?: string;
		responseFormat?: "json_object" | "text";
	},
) {
	const systemPrompt = options?.systemPrompt ?? QUERY_SYSTEM_PROMPT;
	const responseFormat = options?.responseFormat;

	return async (board: QueryBoard, question: string) => {
		const { DeepSeekClient } = await import("../core/client.js");
		const client = new DeepSeekClient(config);

		// ── 将 board 内容序列化为 LLM 可读的结构化文本 ──
		const boardContext = serializeBoardToPrompt(board);

		const userMessage = boardContext
			? `${boardContext}\n\n---\n用户问题: ${question}`
			: question;

		const result = await client.chat({
			model: config.model,
			systemPrompt,
			messages: [{ role: "user", content: userMessage }],
			responseFormat,
			signal,
		});

		// ── 从 LLM 回答中提取 modelSynthesis ──
		const modelSynthesis =
			board.seedNodes.length > 0
				? [
						{
							text: result.content,
							basedOn: board.seedNodes.map((n) => n.nodeId),
							confidence: "medium" as const,
						},
					]
				: [];

		return {
			answer: result.content,
			modelSynthesis,
			usage: result.usage
				? {
						promptTokens: result.usage.promptTokens,
						completionTokens: result.usage.completionTokens,
					}
				: null,
		};
	};
}

/**
 * 将 QueryBoard 序列化为 LLM 可读的结构化文本。
 *
 * 输出格式：
 * ── 局面说明 ──
 * 模式: ask | 种子节点: 5 | 证据节点: 3 | ...
 *
 * ── 种子节点（fromWiki）──
 * [1] 1-e-overview (concept)
 *     claim: e 是自然常数，约 2.718...
 *     evidence: ...
 *     limits: ...
 *
 * ── 证据节点 ──
 * ...
 *
 * ── 反直觉节点 ──
 * ...
 *
 * ── 知识缺口 ──
 * ...
 */
function serializeBoardToPrompt(board: QueryBoard): string {
	if (board.seedNodes.length === 0 && board.evidenceNodes.length === 0) {
		// board 为空时不注入（LLM 回答"没有 wiki 数据"是正确的）
		return "";
	}

	const lines: string[] = [];

	// ── 局面摘要 ──
	lines.push("── 局面说明 ──");
	lines.push(`模式: ${board.mode}`);
	lines.push(
		`种子节点: ${board.seedNodes.length} | 证据节点: ${board.evidenceNodes.length} | 相关节点: ${board.relatedNodes.length}`,
	);
	lines.push(
		`反直觉节点: ${board.counterNodes.length} | 局限节点: ${board.limitNodes.length} | 问题节点: ${board.questionNodes.length}`,
	);
	if (board.gaps.length > 0) {
		lines.push(`知识缺口: ${board.gaps.length}`);
		for (const g of board.gaps) {
			lines.push(`  - ${g.reason}`);
		}
	}
	lines.push("");

	// ── 种子节点（fromWiki）── 这是 LLM 综合回答的核心依据
	lines.push("── 种子节点（fromWiki，你的回答必须基于这些 claim）──");
	for (const n of board.seedNodes) {
		lines.push(`[${n.nodeId}] ${n.title} (${n.kind})`);
		if (n.claim) lines.push(`  claim: ${n.claim}`);
		if (n.evidence.length > 0)
			lines.push(`  evidence: ${n.evidence.join("; ")}`);
		if (n.interpretation) lines.push(`  interpretation: ${n.interpretation}`);
		if (n.limits.length > 0) lines.push(`  limits: ${n.limits.join("; ")}`);
		if (n.tags.length > 0) lines.push(`  tags: ${n.tags.join(", ")}`);
		lines.push("");
	}

	// ── 证据节点 ──
	if (board.evidenceNodes.length > 0) {
		lines.push("── 证据节点 ──");
		for (const n of board.evidenceNodes) {
			lines.push(`[${n.nodeId}] ${n.title} (${n.kind})`);
			if (n.claim) lines.push(`  claim: ${n.claim}`);
			if (n.evidence.length > 0)
				lines.push(`  evidence: ${n.evidence.join("; ")}`);
			lines.push("");
		}
	}

	// ── 相关节点 ──
	if (board.relatedNodes.length > 0) {
		lines.push("── 相关节点（跨领域参考）──");
		for (const n of board.relatedNodes) {
			lines.push(`[${n.nodeId}] ${n.title} (${n.kind})`);
			if (n.claim) lines.push(`  claim: ${n.claim}`);
			lines.push("");
		}
	}

	// ── 反直觉节点 ──
	if (board.counterNodes.length > 0) {
		lines.push("── 反直觉节点（挑战常见认知）──");
		for (const n of board.counterNodes) {
			lines.push(`[${n.nodeId}] ${n.title}`);
			if (n.claim) lines.push(`  claim: ${n.claim}`);
			lines.push("");
		}
	}

	// ── 局限节点 ──
	if (board.limitNodes.length > 0) {
		lines.push("── 局限节点（这些知识的适用边界）──");
		for (const n of board.limitNodes) {
			lines.push(`[${n.nodeId}] ${n.title}`);
			if (n.limits.length > 0) lines.push(`  limits: ${n.limits.join("; ")}`);
			lines.push("");
		}
	}

	// ── source excerpts（trace 模式有）──
	if (board.sourceExcerpts.length > 0) {
		lines.push("── 原始材料摘录 ──");
		for (const ex of board.sourceExcerpts) {
			lines.push(`[source: ${ex.sourceId}, propRefs ${ex.propRefs.join(",")}]`);
			lines.push(`  ${ex.text.slice(0, 500)}`);
			lines.push("");
		}
	}

	return lines.join("\n");
}
