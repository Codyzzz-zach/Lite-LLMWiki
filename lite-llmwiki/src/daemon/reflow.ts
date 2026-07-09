/**
 * reflow — daemon 回流候选标记
 *
 * daemon 职责⑥：定期筛选 query 结果中的高质量内容作为 wiki 节点候选。
 * 不调 LLM——纯启发式筛选（依赖 reflow.ts 的 screenReflowCandidates）。
 *
 * 产出：将候选写入 progress.md 的 ## 待确认 段。
 */

import { type ConfirmItem, writeConfirmSection } from "../evolution/confirm.js";
import {
	type ReflowCandidate,
} from "../evolution/reflow.js";
import { parseWikiFile, scanWikiFiles } from "../knowledge/wiki-parser.js";
import type { AppConfig } from "../types.js";

/** 从 daemon 触发回流筛选：扫描 wiki，标记回流候选 */
export function screenAndWriteReflow(config: AppConfig): number {
	// 收集已有 nodeIds
	const existingNodeIds = new Set<string>();
	const wikiFiles = scanWikiFiles(config.wikiDir);
	for (const filePath of wikiFiles) {
		const parsed = parseWikiFile(filePath);
		if (parsed?.nodeId) existingNodeIds.add(parsed.nodeId);
	}

	// Reflow needs query result cache — not yet implemented. Skipping.——当前 daemon 不维护 query 缓存
	// 等 query 缓存机制就绪后，从此处读取候选并调用 screenReflowCandidates

	console.log("[daemon] reflow: query cache not ready, skipping");
	return 0;
}

/** 将回流候选写入 progress.md */
export function writeReflowCandidatesToProgress(
	projectRoot: string,
	candidates: ReflowCandidate[],
): void {
	const items: ConfirmItem[] = candidates.map((c, i) => ({
		id: `reflow-${i}`,
		type: "reflow" as const,
		priority: "medium" as const,
		summary: `${c.draft.nodeId}: ${c.reason.slice(0, 80)}`,
		createdAt: new Date().toISOString(),
		status: "pending" as const,
	}));

	writeConfirmSection(projectRoot, items);
}
