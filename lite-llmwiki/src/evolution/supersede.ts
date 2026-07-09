/**
 * supersede — 取代确认
 *
 * 当人类确认矛盾关系后，将旧节点标记为 superseded。
 * 不自动取代——裁决权在人类。
 *
 * 设计决策（架构设计 §08 §11）：
 * - 取代 = 只标记不自动取代
 * - LLM judge 是主观的——自动取代有误杀风险
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { updateFrontmatter } from "../knowledge/wiki-parser.js";

/** 确认取代关系：将 targetNodeId 标记为 superseded */
export function supersedeNode(
	wikiDir: string,
	targetNodeId: string,
	replacedByNodeId: string,
): boolean {
	// 遍历 wiki 目录找到目标节点
	const dirs = [
		"concepts",
		"claims",
		"methods",
		"cases",
		"equations",
		"questions",
		"insights",
		"anchors",
		"counters",
	];
	for (const dir of dirs) {
		const dirPath = `${wikiDir}/${dir}`;
		if (!existsSync(dirPath)) continue;
		const files = readdirSync(dirPath).filter((f: string) => f.endsWith(".md"));
		for (const file of files) {
			const fullPath = `${dirPath}/${file}`;
			const content = readFileSync(fullPath, "utf-8");
			if (content.includes(`nodeId: ${targetNodeId}`)) {
				updateFrontmatter(fullPath, {
					status: "legacy",
					supersededBy: replacedByNodeId,
				});
				return true;
			}
		}
	}
	return false;
}

/** 批量确认取代关系 */
export interface SupersedeEntry {
	targetNodeId: string;
	replacedBy: string;
}

export function supersedeNodes(
	wikiDir: string,
	entries: SupersedeEntry[],
): { succeeded: string[]; failed: string[] } {
	const succeeded: string[] = [];
	const failed: string[] = [];
	for (const entry of entries) {
		if (supersedeNode(wikiDir, entry.targetNodeId, entry.replacedBy)) {
			succeeded.push(entry.targetNodeId);
		} else {
			failed.push(entry.targetNodeId);
		}
	}
	return { succeeded, failed };
}
