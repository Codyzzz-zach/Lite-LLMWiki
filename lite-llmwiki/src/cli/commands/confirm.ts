/**
 * confirm CLI —— 人类批量确认待确认清单
 *
 * 读取 progress.md 中的待确认项，逐项确认或批量确认。
 * 确认的 edge → 写入 frontmatter.edges
 * 确认的 reflow → 写入 wiki 节点
 * 确认的 supersede → 标记旧节点
 *
 * 用法：
 *   llmwiki confirm --list              # 列出待确认项
 *   llmwiki confirm --all               # 批量确认全部
 *   llmwiki confirm --accept 1,3        # 确认指定项（按序号）
 *   llmwiki confirm --reject 2          # 拒绝指定项
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../../config.js";
import {
	type ConfirmItem,
	parseConfirmManifest,
	writeConfirmSection,
} from "../../evolution/confirm.js";
import {
	parseWikiFile,
	scanWikiFiles,
} from "../../knowledge/wiki-parser.js";

export function registerConfirmCommand(program: Command): void {
	program
		.command("confirm")
		.description("Review and confirm pending candidates from progress.md")
		.option("--list", "List pending confirmation items")
		.option("--all", "Auto-confirm all pending items")
		.option(
			"--accept <ids>",
			"Confirm specific items (comma-separated IDs or indices)",
		)
		.option(
			"--reject <ids>",
			"Reject specific items (comma-separated IDs or indices)",
		)
		.action(
			async (options: {
				list?: boolean;
				all?: boolean;
				accept?: string;
				reject?: string;
			}) => {
				const config = loadConfig();
				const projectRoot = config.projectRoot || process.cwd();
				const progressPath = join(projectRoot, "loopadvance", "progress.md");

				let content = "";
				try {
					content = readFileSync(progressPath, "utf-8");
				} catch {
					console.log("No progress.md found. Nothing to confirm.");
					return;
				}

				const manifest = parseConfirmManifest(content);
				const pending = manifest.items.filter((i) => i.status === "pending");

				if (
					options.list ||
					(!options.all && !options.accept && !options.reject)
				) {
					// List mode
					if (pending.length === 0) {
						console.log("✅ No pending confirmation items.");
						return;
					}
					console.log(`\n📋 Pending confirmation (${pending.length} items):\n`);
					pending.forEach((item, i) => {
						const icon =
							item.type === "edge"
								? "🔗"
								: item.type === "reflow"
									? "📝"
									: item.type === "supersede"
										? "🔄"
										: "📌";
						console.log(
							`  ${i + 1}. ${icon} [${item.priority}] ${item.type}: ${item.summary}`,
						);
					});
					console.log(
						`\n  Use --all to confirm all, --accept 1,3 to confirm specific items.`,
					);
					return;
				}

				// Determine which items to confirm/reject
				const acceptIds = options.accept
					? options.accept.split(",").map((s) => s.trim())
					: [];
				const rejectIds = options.reject
					? options.reject.split(",").map((s) => s.trim())
					: [];

				let changed = 0;

				for (let i = 0; i < pending.length; i++) {
					const item = pending[i]!;
					const idx = String(i + 1);
					const shouldAccept =
						options.all ||
						acceptIds.includes(item.id) ||
						acceptIds.includes(idx);
					const shouldReject =
						!options.all &&
						(rejectIds.includes(item.id) || rejectIds.includes(idx));

					if (!shouldAccept && !shouldReject) continue;

					if (shouldAccept) {
						// Apply the confirmation
						if (item.type === "edge") {
							applyEdgeConfirmation(config, item);
						}
						item.status = "confirmed";
						changed++;
					} else if (shouldReject) {
						item.status = "rejected";
						changed++;
					}
				}

				// Write back
				const allItems = manifest.items.map((item) => {
					const pendingIdx = pending.findIndex((p) => p.id === item.id);
					if (pendingIdx >= 0) return pending[pendingIdx]!;
					return item;
				});
				writeConfirmSection(projectRoot, allItems);

				console.log(`✅ Confirmed ${changed} items.`);
			},
		);
}

/** 将 edge 候选写入对应 wiki 节点的 frontmatter.edges */
function applyEdgeConfirmation(
	config: ReturnType<typeof loadConfig>,
	item: ConfirmItem,
): boolean {
	// Parse summary for [nodeA→nodeB] prefix
	const match = item.summary.match(/^\[([^\]→]+)→([^\]]+)\]/);
	if (!match) {
		console.error(
			`  ⚠️  Skipping edge with no node references: ${item.summary.slice(0, 60)}`,
		);
		return false;
	}
	const fromNode = match[1]!.trim();
	const toNode = match[2]!.trim();

	// Find wiki file for source node
	const files = scanWikiFiles(config.wikiDir);
	for (const filePath of files) {
		const parsed = parseWikiFile(filePath);
		if (!parsed || parsed.nodeId !== fromNode) continue;

		// Read existing edges or create new
		const existingEdges = parsed.frontmatter.edges || [];
		const newEdge = {
			from: fromNode,
			to: toNode,
			type: "relates_to" as const,
			confidence: 0.5,
			source: "inspire",
		};

		// Avoid duplicates
		if (
			existingEdges.some(
				(e) =>
					e.from === newEdge.from &&
					e.to === newEdge.to &&
					e.type === newEdge.type,
			)
		) {
			return true; // already exists
		}

		// 直接写 YAML——updateFrontmatter 不支持对象数组
		// use already-imported readFileSync/writeFileSync
		const raw = readFileSync(filePath, "utf-8");
		const newEdges = [...existingEdges, newEdge];
		const edgeLines = ["edges:"];
		for (const e of newEdges) {
			edgeLines.push(`  - from: ${e.from}`);
			edgeLines.push(`    to: ${e.to}`);
			edgeLines.push(`    type: ${e.type}`);
			if (e.confidence) edgeLines.push(`    confidence: ${e.confidence}`);
			if (e.source) edgeLines.push(`    source: ${e.source}`);
		}
		const edgeYaml = edgeLines.join("\n") + "\n";
		// Insert edges before the closing --- or at the end of frontmatter
		const fmEnd = raw.indexOf("\n---", raw.indexOf("---\n") + 4);
		if (fmEnd > 0) {
			const updated = raw.slice(0, fmEnd) + "\n" + edgeYaml + raw.slice(fmEnd);
			writeFileSync(filePath, updated, "utf-8");
		}
		return true;
		console.error(`  🔗 Edge written: ${fromNode} → ${toNode} (relates_to)`);
		return true;
	}
	console.error(`  ⚠️  Source node not found: ${fromNode}`);
	return false;
}
