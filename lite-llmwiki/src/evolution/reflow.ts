/**
 * reflow — 回流候选标记
 *
 * 将 query 结果中高质量的 LLM 综合内容标记为 wiki 节点候选。
 * daemon 定期筛选 → 人类确认后写回 wiki。
 *
 * 设计决策（架构设计 §08 §11）：
 * - 回流节点信任层级 < 编译节点（没有 chase 命题原文）
 * - 标 reflowOrigin + derived_from 边指向来源节点
 */

import type { WikiFrontmatter, WikiNodeDraft } from "../types.js";

export interface ReflowCandidate {
	/** 候选节点草稿 */
	draft: WikiNodeDraft;
	/** 来源——从哪个节点的 query 结果中回流 */
	derivedFrom: string[];
	/** 回流原因 */
	reason: string;
	/** 置信度 0-1 */
	confidence: number;
}

/**
 * 筛选回流候选。
 *
 * 规则（不调 LLM——纯启发式）：
 * - claim 长度 ≥ 50 字符（有实质内容）
 * - 不在已有 nodeIds 中（非重复）
 * - 置信度 ≥ 0.6
 */
export function screenReflowCandidates(
	candidates: ReflowCandidate[],
	existingNodeIds: Set<string>,
): ReflowCandidate[] {
	return candidates.filter((c) => {
		if (c.draft.claim.length < 50) return false;
		if (existingNodeIds.has(c.draft.nodeId)) return false;
		if (c.confidence < 0.6) return false;
		return true;
	});
}

/** 从回流候选生成 frontmatter（带 reflowOrigin 标记） */
export function reflowToFrontmatter(
	candidate: ReflowCandidate,
	existing: WikiFrontmatter,
): WikiFrontmatter {
	return {
		...existing,
		nodeId: candidate.draft.nodeId,
		kind: candidate.draft.kind,
		title: candidate.draft.frontmatter.title,
		reflowOrigin: candidate.derivedFrom.join(","),
		confidence: candidate.confidence,
		status: "draft", // 回流节点初始为 draft——需人类确认
		createdAt: new Date().toISOString(),
		edges: candidate.derivedFrom.map((sourceNodeId) => ({
			from: candidate.draft.nodeId,
			to: sourceNodeId,
			type: "derived_from" as const,
			confidence: candidate.confidence,
			source: "reflow",
		})),
	};
}
