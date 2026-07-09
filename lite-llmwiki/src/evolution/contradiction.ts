/**
 * contradiction — 矛盾检测
 *
 * 比较新编译节点与现有 wiki 节点，检测语义矛盾。
 * 发现矛盾时产出 contradicts 边候选 → 写入 progress.md。
 *
 * 设计决策（架构设计 §11）：
 * - 检测是自动的（daemon 触发），裁决是人类的
 * - 矛盾标记为 contradicts 边——不自动取代
 */

import { buildGraph } from "../knowledge/graph.js";
import type { GraphData } from "../knowledge/graph.js";
import type { GraphEdge, WikiNodeDraft } from "../types.js";
import type { AppConfig } from "../types.js";

// ─── 类型 ──────────────────────────────────────────────────────────

export interface ContradictionCandidate {
	/** 产生矛盾的节点 */
	nodeA: string;
	/** 与之矛盾的节点 */
	nodeB: string;
	/** 矛盾描述 */
	reason: string;
	/** 置信度 0-1 */
	confidence: number;
}

export interface ContradictionResult {
	candidates: ContradictionCandidate[];
}

// ─── Prompt ────────────────────────────────────────────────────────

const CONTRADICTION_SYSTEM = `你是一个知识矛盾检测器。对比新节点和已有节点，判断是否存在语义矛盾。

# 矛盾判断标准
- 两个节点在同一个事实上给出了互斥的结论
- 一个节点声称 X 为真，另一个声称 X 为假
- 不是观点分歧——必须是事实层面的冲突

# 输出格式
返回 JSON 数组（可能为空）：
[{"nodeA":"新节点id","nodeB":"已有节点id","reason":"矛盾描述","confidence":0.8}]`;

function buildContradictionPrompt(
	newNode: { nodeId: string; claim: string; kind: string },
	existingNodes: Array<{ nodeId: string; claim: string; kind: string }>,
): string {
	if (existingNodes.length === 0) return "";
	const existing = existingNodes
		.map((n) => `[${n.nodeId}] (${n.kind}) ${n.claim}`)
		.join("\n\n");
	return `新节点：
[${newNode.nodeId}] (${newNode.kind}) ${newNode.claim}

已有节点：
${existing}

请判断新节点是否与已有节点存在事实矛盾。请以JSON数组格式返回结果。`;
}

// ─── 检测逻辑 ──────────────────────────────────────────────────────

/** 从图谱中获取可能的矛盾对（同 kind 但不同 source 的节点） */
/**
 * 检测新节点与已有节点的矛盾。
 *
 * @param config - 应用配置
 * @param newNode - 新编译的 wiki 节点
 * @param existingClaims - 已有节点的 claim 列表（带 nodeId）
 * @param llmCaller - LLM 调用函数
 */
export async function detectContradictions(
	config: AppConfig,
	newNode: WikiNodeDraft,
	existingClaims: Array<{ nodeId: string; claim: string; kind: string }>,
	llmCaller: (prompt: string) => Promise<string>,
): Promise<ContradictionResult> {
	if (existingClaims.length === 0) return { candidates: [] };

	// 先做粗筛：只保留与 newNode 同 kind 的已有节点
	const sameKind = existingClaims.filter((n) => n.kind === newNode.kind);
	if (sameKind.length === 0) return { candidates: [] };

	const prompt = buildContradictionPrompt(
		{ nodeId: newNode.nodeId, claim: newNode.claim, kind: newNode.kind },
		sameKind,
	);
	if (!prompt) return { candidates: [] };

	const response = await llmCaller(prompt);
	try {
		const parsed = JSON.parse(response.trim());
		if (!Array.isArray(parsed)) return { candidates: [] };
		return {
			candidates: parsed
				.filter((c: Record<string, unknown>) => c.nodeA && c.nodeB && c.reason)
				.map((c: Record<string, unknown>) => ({
					nodeA: String(c.nodeA),
					nodeB: String(c.nodeB),
					reason: String(c.reason),
					confidence: typeof c.confidence === "number" ? c.confidence : 0.5,
				})),
		};
	} catch {
		return { candidates: [] };
	}
}

/** 将矛盾候选转换为 graph edges */
export function contradictionsToEdges(
	candidates: ContradictionCandidate[],
): GraphEdge[] {
	return candidates.map((c) => ({
		from: c.nodeA,
		to: c.nodeB,
		type: "contradicts" as const,
		confidence: c.confidence,
		source: "contradiction-detection",
	}));
}
