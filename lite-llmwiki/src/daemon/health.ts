/**
 * health — 系统健康度采集器（Loop A 核心）
 *
 * 统一收集代码 + wiki + 图谱 + daemon + backlog 五项健康指标，
 * 产出 SystemHealth 结构——loop-health.sh 和 agent 通过此模块
 * 获取系统完整状态，驱动自迭代决策。
 *
 * 输出方式：
 *   npx tsx src/daemon/health.ts           # 人类可读
 *   npx tsx src/daemon/health.ts --json    # agent 可读
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import {
	type DaemonState,
	isDaemonAlive,
	readDaemonState,
} from "../daemon/state.js";
import { checkBacklog, parseConfirmManifest } from "../evolution/confirm.js";
import { buildGraph, getGraphStats } from "../knowledge/graph.js";
import { parseWikiFile, scanWikiFiles } from "../knowledge/wiki-parser.js";

// ─── 类型 ──────────────────────────────────────────────────────────

export interface CodeHealth {
	typecheck: boolean; // true = npm run typecheck 退出 0
	test: boolean; // true = npm run test 全绿
	gitModified: number; // 未提交修改文件数
}

export interface WikiHealth {
	totalNodes: number;
	auditBreakdown: {
		passed: number;
		warning: number;
		failed: number;
		pending: number;
	};
	averageScore: number;
	nodesMissingProps: number;
}

export interface GraphHealth {
	totalNodes: number;
	totalEdges: number;
	orphanCount: number;
	orphanRate: number;
	contradictionCount: number;
}

export interface BacklogHealth {
	count: number;
	level: "normal" | "warning" | "degraded";
}

export interface SystemHealth {
	timestamp: string;
	code: CodeHealth;
	wiki: WikiHealth;
	graph: GraphHealth;
	daemon: {
		running: boolean;
		pid: number | null;
		stats: DaemonState["stats"] | null;
	};
	backlog: BacklogHealth;
	verdict: "green" | "yellow" | "red";
}

// ─── 采集 ──────────────────────────────────────────────────────────

export function collectHealth(): SystemHealth {
	const config = loadConfig();
	const projectRoot = config.projectRoot || process.cwd();

	// 1. Code health — 从 loop-health.sh 传入，这里给占位值
	const code: CodeHealth = { typecheck: true, test: true, gitModified: 0 };

	// 2. Wiki health — 扫描全部 wiki 节点，统计 audit 分布
	const wiki = collectWikiHealth(config);

	// 3. Graph health — 读图谱统计
	const graph = collectGraphHealth(config);

	// 4. Daemon — 读 daemon-state.json
	const daemon = collectDaemonHealth(projectRoot);

	// 5. Backlog — 读 progress.md 待确认积压
	const backlog = collectBacklogHealth(projectRoot);

	// 6. 综合判定
	const verdict = computeVerdict(code, wiki, graph, backlog);

	return {
		timestamp: new Date().toISOString(),
		code,
		wiki,
		graph,
		daemon,
		backlog,
		verdict,
	};
}

// ─── 子采集器 ──────────────────────────────────────────────────────

function collectWikiHealth(config: ReturnType<typeof loadConfig>): WikiHealth {
	const files = scanWikiFiles(config.wikiDir);
	const breakdown = { passed: 0, warning: 0, failed: 0, pending: 0 };
	let totalScore = 0;
	let scoredNodes = 0;
	let missingProps = 0;

	for (const filePath of files) {
		const parsed = parseWikiFile(filePath);
		if (!parsed) continue;
		const fm = parsed.frontmatter;

		const status = fm.auditStatus ?? "pending";
		if (status === "passed") breakdown.passed++;
		else if (status === "warning") breakdown.warning++;
		else if (status === "failed") breakdown.failed++;
		else breakdown.pending++;

		if (fm.auditScore !== undefined) {
			totalScore += fm.auditScore;
			scoredNodes++;
		}

		if (!fm.propRefs || fm.propRefs.length === 0) {
			missingProps++;
		}
	}

	return {
		totalNodes: files.length,
		auditBreakdown: breakdown,
		averageScore:
			scoredNodes > 0 ? Math.round((totalScore / scoredNodes) * 100) / 100 : 0,
		nodesMissingProps: missingProps,
	};
}

function collectGraphHealth(
	config: ReturnType<typeof loadConfig>,
): GraphHealth {
	try {
		const graph = buildGraph(config);
		const stats = getGraphStats(graph);
		return {
			totalNodes: stats.totalNodes,
			totalEdges: stats.totalEdges,
			orphanCount: stats.orphanCount,
			orphanRate: stats.orphanRate,
			contradictionCount: stats.contradictionCount,
		};
	} catch {
		return {
			totalNodes: 0,
			totalEdges: 0,
			orphanCount: 0,
			orphanRate: 0,
			contradictionCount: 0,
		};
	}
}

function collectDaemonHealth(projectRoot: string) {
	const state = readDaemonState(projectRoot);
	if (!state) return { running: false, pid: null, stats: null };
	return {
		running: isDaemonAlive(state),
		pid: state.pid,
		stats: state.stats,
	};
}

function collectBacklogHealth(projectRoot: string): BacklogHealth {
	const progressPath = join(projectRoot, "loopadvance", "progress.md");
	if (!existsSync(progressPath)) return { count: 0, level: "normal" };
	try {
		const content = readFileSync(progressPath, "utf-8");
		const manifest = parseConfirmManifest(content);
		const status = checkBacklog(manifest);
		return { count: status.count, level: status.level };
	} catch {
		return { count: 0, level: "normal" };
	}
}

function computeVerdict(
	code: CodeHealth,
	wiki: WikiHealth,
	graph: GraphHealth,
	backlog: BacklogHealth,
): "green" | "yellow" | "red" {
	// Red: 代码不健康
	if (!code.typecheck || !code.test) return "red";
	// Red: 积压 > 50
	if (backlog.level === "degraded") return "red";
	// Yellow: warning 节点 > 20% 或 orphan > 30% 或积压 > 20
	if (
		wiki.totalNodes > 0 &&
		wiki.auditBreakdown.warning / wiki.totalNodes > 0.2
	)
		return "yellow";
	if (graph.orphanRate > 30) return "yellow";
	if (backlog.level === "warning") return "yellow";
	// Yellow: 有 failed 节点
	if (wiki.auditBreakdown.failed > 0) return "yellow";
	// Green: 全部健康
	return "green";
}

// ─── CLI 入口 ──────────────────────────────────────────────────────

const isJsonMode = process.argv.includes("--json");
const health = collectHealth();

if (isJsonMode) {
	console.log(JSON.stringify(health, null, 2));
} else {
	console.log("");
	console.log("  📊  System Health");
	console.log("  ───────────────────────────────────────────");
	console.log("");
	console.log("  ── Wiki ──");
	console.log(`  nodes:        ${health.wiki.totalNodes}`);
	console.log(
		`  audit:        ${health.wiki.auditBreakdown.passed} passed / ${health.wiki.auditBreakdown.warning} warning / ${health.wiki.auditBreakdown.failed} failed / ${health.wiki.auditBreakdown.pending} pending`,
	);
	console.log(`  avg score:    ${health.wiki.averageScore}`);
	console.log(`  missing props: ${health.wiki.nodesMissingProps}`);
	console.log("");
	console.log("  ── Graph ──");
	console.log(`  nodes:        ${health.graph.totalNodes}`);
	console.log(`  edges:        ${health.graph.totalEdges}`);
	console.log(
		`  orphans:      ${health.graph.orphanCount} (${health.graph.orphanRate}%)`,
	);
	console.log(`  contradicts:  ${health.graph.contradictionCount}`);
	console.log("");
	console.log("  ── Daemon ──");
	console.log(`  running:      ${health.daemon.running}`);
	if (health.daemon.running) {
		console.log(`  pid:          ${health.daemon.pid}`);
		console.log(
			`  stats:        ${health.daemon.stats?.propsExtracted ?? 0} props, ${health.daemon.stats?.lintsRun ?? 0} lints`,
		);
	}
	console.log("");
	console.log("  ── Backlog ──");
	console.log(
		`  pending:      ${health.backlog.count} (${health.backlog.level})`,
	);
	console.log("");
	console.log(
		`  Verdict:      ${health.verdict === "green" ? "✅ GREEN" : health.verdict === "yellow" ? "⚠️ YELLOW" : "❌ RED"}`,
	);
	console.log("");
}
