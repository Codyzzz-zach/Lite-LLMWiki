/**
 * reinforce — 强化检测（LLM judge 双维度）
 *
 * 当新材料支持已有声明时（非矛盾、非取代），标记 reinforcement 候选。
 * 人类确认后提升已有节点的 auditScore。
 *
 * 设计决策（架构设计 §08 §11）：
 * - 强化提升 auditScore（不是遗忘曲线）
 * - 双维度判断：语义一致度（LLM judge） + 证据增量度（LLM judge）
 * - trivial vs genuine reinforcement：数学常数不需要独立验证
 * - 检测由 daemon 触发，确认由人类裁决
 */

import type { WikiNodeDraft } from "../types.js";

export interface ReinforcementCandidate {
	existingNodeId: string;
	supportingNodeId: string;
	reason: string;
	confidence: number;
	suggestedScoreBoost: number;
	/** LLM judge 的语义一致度 */
	semanticConsistency: number;
	/** LLM judge 的证据增量度 */
	evidenceIncrement: number;
}

// ─── Prompt ────────────────────────────────────────────────────────

const CONSISTENCY_PROMPT = `你是语义一致性判断器。对比两个 claim，判断它们是否在说同一件事。

# 判断标准
- 说的是同一个核心事实/结论 → 高一致性
- 相关但不完全相同 → 中一致性
- 说的是不同的事 → 低一致性

# 输出
{"consistent": true/false, "score": 0.0-1.0, "reason": "一句话解释"}`;

const INCREMENT_PROMPT = `你是证据增量判断器。已有节点和新节点的 claim 在说同一件事。判断新来源是否提供了独立的经验证据。

# 判断标准
- 新来源有旧来源没有的独立验证（实验复现、不同数据、独立推导）→ 高增量
- 新来源只是在复述同一个事实、没有新的经验支撑 → 低增量
- 数学常数、定义、公理不需要独立验证 → 增量度为 0

# 输出
{"genuine": true/false, "score": 0.0-1.0, "reason": "一句话解释"}`;

// ─── 预筛 ──────────────────────────────────────────────────────────

const SEMANTIC_CONSISTENCY_THRESHOLD = 0.7;
const EVIDENCE_INCREMENT_THRESHOLD = 0.5;

function prefilterByKeywords(
	newNode: WikiNodeDraft,
	existingNodes: Array<{
		nodeId: string;
		claim: string;
		kind: string;
		auditScore?: number;
	}>,
): Array<{ nodeId: string; claim: string; kind: string; auditScore?: number }> {
	const newWords = extractKeywords(newNode.claim);
	if (newWords.length < 3) return [];

	return existingNodes.filter((existing) => {
		if (existing.nodeId === newNode.nodeId) return false;
		if (existing.kind !== newNode.kind) return false;
		const existingWords = extractKeywords(existing.claim);
		if (existingWords.length < 3) return false;
		const overlap = newWords.filter((w) => existingWords.includes(w));
		return (
			overlap.length / Math.max(newWords.length, existingWords.length) > 0.2
		);
	});
}

// ─── 主入口 ────────────────────────────────────────────────────────

export async function detectReinforcementCandidates(
	newNode: WikiNodeDraft,
	existingNodes: Array<{
		nodeId: string;
		claim: string;
		kind: string;
		auditScore?: number;
	}>,
	llmCaller: (systemPrompt: string, userMessage: string) => Promise<string>,
): Promise<ReinforcementCandidate[]> {
	const candidates: ReinforcementCandidate[] = [];

	// 1. 关键词预筛（减少 LLM 调用量）
	const prefiltered = prefilterByKeywords(newNode, existingNodes);
	if (prefiltered.length === 0) return candidates;

	for (const existing of prefiltered) {
		// 2. 语义一致度：LLM judge
		let consistencyScore: number;
		let consistencyReason: string;
		try {
			const response = await llmCaller(
				CONSISTENCY_PROMPT,
				`Claim A: ${newNode.claim}\n\nClaim B: ${existing.claim}`,
			);
			const parsed = JSON.parse(response.trim());
			consistencyScore = typeof parsed.score === "number" ? parsed.score : 0;
			consistencyReason = parsed.reason || "";
		} catch {
			continue; // LLM 失败 → 跳过该对
		}

		if (consistencyScore < SEMANTIC_CONSISTENCY_THRESHOLD) continue;

		// 3. 证据增量度：LLM judge
		let incrementScore: number;
		let incrementReason: string;
		try {
			const response = await llmCaller(
				INCREMENT_PROMPT,
				`已有节点 Claim: ${existing.claim}\n\n新节点 Claim: ${newNode.claim}`,
			);
			const parsed = JSON.parse(response.trim());
			incrementScore = typeof parsed.score === "number" ? parsed.score : 0;
			incrementReason = parsed.reason || "";
		} catch {
			continue;
		}

		if (incrementScore < EVIDENCE_INCREMENT_THRESHOLD) continue;

		// 4. 通过双维度 → 标记候选
		const confidence = (consistencyScore + incrementScore) / 2;
		candidates.push({
			existingNodeId: existing.nodeId,
			supportingNodeId: newNode.nodeId,
			reason: `一致度 ${consistencyScore.toFixed(2)} · 增量度 ${incrementScore.toFixed(2)}: ${consistencyReason} | ${incrementReason}`,
			confidence,
			suggestedScoreBoost: Math.min(0.15, incrementScore * 0.2),
			semanticConsistency: consistencyScore,
			evidenceIncrement: incrementScore,
		});
	}

	return candidates;
}

function extractKeywords(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[\s,，。？、；：()（）\[\]【】"'`!?;:「」.，]+/)
		.map((w) => w.trim())
		.filter((w) => w.length > 1);
}
