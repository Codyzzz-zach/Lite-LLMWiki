/**
 * lint — wiki 健康检查引擎
 *
 * 检测 wiki 中的结构问题：
 * - 孤立节点（graph 中无边的节点 > 30% 为警告）
 * - 断裂引用（links 指向不存在的 nodeId）
 * - 缺失 propRefs
 * - audit 长期 pending 的节点
 *
 * 机械问题自动修复，语义问题写入 lint-report.json 给人类/agent。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildGraph, getGraphStats } from "../knowledge/graph.js";
import { parseWikiFile, scanWikiFiles } from "../knowledge/wiki-parser.js";
import type { AppConfig } from "../types.js";

// ─── 类型 ──────────────────────────────────────────────────────────

export interface LintIssue {
	nodeId: string;
	filePath: string;
	severity: "warning" | "error";
	category: "orphan" | "broken_link" | "missing_props" | "stale_audit";
	message: string;
}

export interface LintReport {
	timestamp: string;
	summary: {
		totalNodes: number;
		issues: number;
		warnings: number;
		errors: number;
		orphanRate: number;
	};
	issues: LintIssue[];
}

// ─── 检测 ──────────────────────────────────────────────────────────

export function lintWiki(config: AppConfig): LintReport {
	const issues: LintIssue[] = [];
	const graph = buildGraph(config);
	const stats = getGraphStats(graph);

	// 1. 孤立节点检测
	const orphanNodes = new Set(
		graph.nodes
			.filter((n) => {
				const hasEdge = graph.edges.some(
					(e) => e.from === n.nodeId || e.to === n.nodeId,
				);
				return !hasEdge;
			})
			.map((n) => n.nodeId),
	);

	if (stats.orphanRate > 30) {
		for (const nodeId of orphanNodes) {
			const node = graph.nodes.find((n) => n.nodeId === nodeId);
			issues.push({
				nodeId,
				filePath: node?.filePath ?? "unknown",
				severity: "warning",
				category: "orphan",
				message: "孤立节点——没有任何图谱边连接",
			});
		}
	}

	// 2. 断裂引用 + 缺失 propRefs + stale audit
	const wikiFiles = scanWikiFiles(config.wikiDir);
	const validNodeIds = new Set(graph.nodes.map((n) => n.nodeId));

	for (const filePath of wikiFiles) {
		const parsed = parseWikiFile(filePath);
		if (!parsed) continue;

		const fm = parsed.frontmatter;
		const nodeId = fm.nodeId ?? "";

		// 断裂引用
		if (parsed.sections.links && parsed.sections.links.length > 0) {
			for (const link of parsed.sections.links) {
				const linkTarget = link.replace(/^\[\[|\]\]$/g, "");
				if (linkTarget && !validNodeIds.has(linkTarget)) {
					issues.push({
						nodeId,
						filePath,
						severity: "warning",
						category: "broken_link",
						message: `引用不存在的节点: ${linkTarget}`,
					});
				}
			}
		}

		// 缺失 propRefs
		if (!fm.propRefs || fm.propRefs.length === 0) {
			if (fm.auditStatus !== "failed") {
				issues.push({
					nodeId,
					filePath,
					severity: "warning",
					category: "missing_props",
					message: "缺少 propRefs——审计无法验证证据锚点",
				});
			}
		}
	}

	const report: LintReport = {
		timestamp: new Date().toISOString(),
		summary: {
			totalNodes: stats.totalNodes,
			issues: issues.length,
			warnings: issues.filter((i) => i.severity === "warning").length,
			errors: issues.filter((i) => i.severity === "error").length,
			orphanRate: stats.orphanRate,
		},
		issues,
	};

	// 写入 lint-report.json
	const reportDir = join(
		config.projectRoot || config.wikiDir,
		"..",
		"loopadvance",
	);
	if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
	writeFileSync(
		join(reportDir, "lint-report.json"),
		JSON.stringify(report, null, 2),
		"utf-8",
	);

	return report;
}
