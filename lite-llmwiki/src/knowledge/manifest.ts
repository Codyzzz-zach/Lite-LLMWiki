/**
 * graph-ready manifest — Phase 7 helpers
 *
 * - computeClaimHash: 用于去重、合并、未来 graph 边构建
 * - generateRelatedFor: 自动从 shared tags / shared sourceIds 推导 related
 *
 * 短期实现（plan 12.4 + 7.5）：
 * - claim hash = sha256(normalized claim)[:16]
 * - related = union of explicit related + shared tags + shared sourceIds
 */
import { createHash } from "node:crypto";

/** 节点最小元数据（用于 related 生成；不依赖完整 BoardNode） */
export interface RelatedSeed {
	nodeId: string;
	kind: string;
	sourceIds?: string[];
	tags?: string[];
	related?: string[];
}

/** related 项输出 */
export interface RelatedNode {
	nodeId: string;
	kind: string;
	/** 推导依据：tag-shared / source-shared / explicit */
	reason: "tag-shared" | "source-shared" | "explicit";
}

/** 计算 claim 的稳定 hash（plan 12.4） */
export function computeClaimHash(claim: string): string {
	const normalized = claim.trim().replace(/\s+/g, " ");
	return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/**
 * 自动生成 related 列表（plan 7.5）：
 * 1. explicit related（在 seed 自身的 related 列表里）
 * 2. shared tags
 * 3. shared sourceIds
 *
 * 同一节点可能通过多个 reason 匹配 → reason 优先级：explicit > tag-shared > source-shared
 */
export function generateRelatedFor(
	seed: RelatedSeed,
	pool: RelatedSeed[],
): RelatedNode[] {
	const out: RelatedNode[] = [];
	const seen = new Set<string>();
	const seedTags = new Set(seed.tags ?? []);
	const seedSources = new Set(seed.sourceIds ?? []);
	const explicit = new Set(seed.related ?? []);

	for (const candidate of pool) {
		if (candidate.nodeId === seed.nodeId) continue;
		if (seen.has(candidate.nodeId)) continue;
		let reason: RelatedNode["reason"] | null = null;
		if (explicit.has(candidate.nodeId)) {
			reason = "explicit";
		} else if (candidate.tags?.some((t) => seedTags.has(t))) {
			reason = "tag-shared";
		} else if (candidate.sourceIds?.some((s) => seedSources.has(s))) {
			reason = "source-shared";
		}
		if (reason) {
			out.push({ nodeId: candidate.nodeId, kind: candidate.kind, reason });
			seen.add(candidate.nodeId);
		}
	}

	return out;
}
