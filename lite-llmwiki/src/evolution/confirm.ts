/**
 * confirm — 确认管线
 *
 * 人类定期批量处理待确认清单的入口。
 * 读取 progress.md 中的待确认项，应用确认后的变更。
 *
 * 设计决策（架构设计 §09）：
 * - 人类确认 = 定期批量 + agent 预筛选 + 积压自动降级
 * - 积压 > 50 自动降级——低优先项超时跳过，高优先项合并
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ─── 类型 ──────────────────────────────────────────────────────────

export type ConfirmItemType =
	| "reflow"
	| "edge"
	| "supersede"
	| "reinforce"
	| "semantic_issue";

export interface ConfirmItem {
	id: string;
	type: ConfirmItemType;
	priority: "high" | "medium" | "low";
	summary: string;
	createdAt: string;
	status: "pending" | "confirmed" | "rejected" | "skipped";
}

export interface ConfirmManifest {
	items: ConfirmItem[];
	lastProcessedAt: string | null;
	backlog: number;
}

// ─── 解析 ──────────────────────────────────────────────────────────

/** 从 progress.md 解析待确认清单 */
export function parseConfirmManifest(content: string): ConfirmManifest {
	const items: ConfirmItem[] = [];
	const lastProcessedAt: string | null = null;

	const lines = content.split("\n");
	let inConfirmSection = false;

	for (const line of lines) {
		if (line.includes("## 待确认") || line.includes("## Pending")) {
			inConfirmSection = true;
			continue;
		}
		if (inConfirmSection && line.startsWith("## ")) {
			inConfirmSection = false;
			continue;
		}
		if (!inConfirmSection) continue;

		// 解析 `- [ ] [high] reflow: ...` 格式
		const itemMatch = line.match(
			/^-\s*\[([ xX])\]\s*\[(\w+)\]\s*(\w+):\s*(.+)$/,
		);
		if (itemMatch) {
			items.push({
				id: `confirm-${items.length + 1}`,
				type: itemMatch[3] as ConfirmItemType,
				priority: itemMatch[2] as "high" | "medium" | "low",
				summary: itemMatch[4]!.trim(),
				createdAt: new Date().toISOString(),
				status:
					itemMatch[1] === "x" || itemMatch[1] === "X"
						? "confirmed"
						: "pending",
			});
		}
	}

	// 积压计数 = 待处理项
	const backlog = items.filter((i) => i.status === "pending").length;

	return { items, lastProcessedAt, backlog };
}

// ─── 积压保护 ──────────────────────────────────────────────────────

const BACKLOG_WARN_THRESHOLD = 20;
const BACKLOG_DEGRADE_THRESHOLD = 50;

export interface BacklogStatus {
	level: "normal" | "warning" | "degraded";
	count: number;
	message: string;
}

/** 检查积压状态 */
export function checkBacklog(manifest: ConfirmManifest): BacklogStatus {
	if (manifest.backlog >= BACKLOG_DEGRADE_THRESHOLD) {
		return {
			level: "degraded",
			count: manifest.backlog,
			message: `积压 ${manifest.backlog} 项超过 ${BACKLOG_DEGRADE_THRESHOLD}——触发自动降级。低优先项跳过，中优先项合并。`,
		};
	}
	if (manifest.backlog >= BACKLOG_WARN_THRESHOLD) {
		return {
			level: "warning",
			count: manifest.backlog,
			message: `积压 ${manifest.backlog} 项超过 ${BACKLOG_WARN_THRESHOLD}——建议尽快处理。`,
		};
	}
	return { level: "normal", count: manifest.backlog, message: "" };
}

/** 自动降级：移除低优先 pending 项，合并中优先项 */
export function autoDegrade(manifest: ConfirmManifest): ConfirmManifest {
	const filtered = manifest.items.filter((item) => {
		if (item.status !== "pending") return true;
		if (item.priority === "low") return false; // 跳过低优先
		return true;
	});

	// 合并中优先的同类型项
	const merged: ConfirmItem[] = [];
	const mediumByType = new Map<string, ConfirmItem[]>();
	for (const item of filtered) {
		if (item.status === "pending" && item.priority === "medium") {
			const key = item.type;
			if (!mediumByType.has(key)) mediumByType.set(key, []);
			mediumByType.get(key)!.push(item);
		} else {
			merged.push(item);
		}
	}
	for (const [type, items] of mediumByType) {
		if (items.length > 1) {
			merged.push({
				id: `merged-${type}`,
				type: type as ConfirmItemType,
				priority: "medium",
				summary: `${items.length} 项 ${type} 合并处理`,
				createdAt: new Date().toISOString(),
				status: "pending",
			});
		} else if (items.length === 1) {
			merged.push(items[0]!);
		}
	}

	return {
		...manifest,
		items: merged,
		backlog: merged.filter((i) => i.status === "pending").length,
	};
}

// ─── 写入 ──────────────────────────────────────────────────────────

/** 将确认清单写回 progress.md 的 ## 待确认 段 */
export function writeConfirmSection(
	projectRoot: string,
	items: ConfirmItem[],
): void {
	const progressPath = join(projectRoot, "loopadvance", "progress.md");
	let content = "";
	if (existsSync(progressPath)) {
		content = readFileSync(progressPath, "utf-8");
	}

	const lines: string[] = [];
	lines.push("## 待确认");
	lines.push("");
	if (items.length === 0) {
		lines.push("（无待确认项）");
	} else {
		for (const item of items) {
			const checked = item.status === "confirmed" ? "x" : " ";
			lines.push(
				`- [${checked}] [${item.priority}] ${item.type}: ${item.summary}`,
			);
		}
	}
	lines.push("");

	// 替换或追加 ## 待确认 段
	const sectionStart = content.indexOf("## 待确认");
	if (sectionStart >= 0) {
		const sectionEnd = content.indexOf("\n## ", sectionStart + 1);
		const before = content.slice(0, sectionStart);
		const after = sectionEnd >= 0 ? content.slice(sectionEnd) : "";
		writeFileSync(progressPath, before + lines.join("\n") + after, "utf-8");
	} else {
		writeFileSync(progressPath, content + "\n" + lines.join("\n"), "utf-8");
	}
}
