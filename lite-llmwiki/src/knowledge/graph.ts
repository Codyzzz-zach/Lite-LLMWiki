/**
 * graph — 知识图谱系统
 *
 * 图谱是 board 强制注入的升级——让 contradicts/derived_from 边不再依赖搜索。
 *
 * 设计决策（架构设计 §08 §17#1）：
 * - frontmatter.edges 是边的主数据源（source of truth）
 * - graph.json 是 daemon 重建的聚合索引（只读缓存）
 * - CLI fallback 只在内存中重建，不写文件
 *
 * graph.json 结构：
 * {
 *   "nodes": [{ "nodeId": "...", "kind": "...", "title": "..." }],
 *   "edges": [{ "from": "nodeA", "to": "nodeB", "type": "contradicts", "confidence": 0.8 }]
 * }
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig, GraphEdge, WikiKind } from "../types.js";
import { parseWikiContent } from "./wiki-parser.js";

// ─── 类型 ──────────────────────────────────────────────────────────

export interface GraphNode {
	nodeId: string;
	kind: WikiKind;
	title: string;
	filePath: string;
}

export interface GraphData {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

export interface GraphStats {
	totalNodes: number;
	totalEdges: number;
	orphanCount: number;
	orphanRate: number;
	contradictionCount: number;
	edgeTypeBreakdown: Record<string, number>;
}

// ─── 构建 ──────────────────────────────────────────────────────────

/**
 * 从 wiki 目录重建完整图谱。
 *
 * 读取所有 wiki/*.md 文件，提取 frontmatter.edges，
 * 合并去重后返回完整的 GraphData。
 * 这是 graph.json 的唯一构建路径。
 */
export function buildGraph(config: AppConfig): GraphData {
	const nodes: GraphNode[] = [];
	const allEdges: GraphEdge[] = [];
	const nodeIds = new Set<string>();

	const wikiDir = config.wikiDir;
	const wikiDirs = [
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

	for (const dir of wikiDirs) {
		const dirPath = join(wikiDir, dir);
		// readdirSync would throw if dir doesn't exist; skip silently
		let files: string[];
		try {
			files = readdirSync(dirPath).filter((f: string) => f.endsWith(".md"));
		} catch {
			continue;
		}

		for (const file of files) {
			const fullPath = join(dirPath, file);
			let content: string;
			try {
				content = readFileSync(fullPath, "utf-8");
			} catch {
				continue;
			}

			const parsed = parseWikiContent(content, `wiki/${dir}/${file}`);
			const fm = parsed.frontmatter;

			if (!fm.nodeId) continue;
			nodeIds.add(fm.nodeId);

			nodes.push({
				nodeId: fm.nodeId,
				kind: fm.kind ?? "concept",
				title: fm.title ?? file.replace(/\.md$/, ""),
				filePath: `wiki/${dir}/${file}`,
			});

			// 收集该节点的 edges（JSON 字符串——YAML 解析器不支持嵌套对象）
			const rawEdges = fm.edges;
			if (rawEdges) {
				let edgeList: GraphEdge[];
				if (typeof rawEdges === "string") {
					try {
						edgeList = JSON.parse(rawEdges as string);
					} catch {
						continue;
					}
				} else if (Array.isArray(rawEdges)) {
					edgeList = rawEdges as unknown as GraphEdge[];
				} else {
					continue;
				}
				for (const edge of edgeList) {
					if (edge.from && edge.to && edge.type) {
						allEdges.push({
							from: edge.from,
							to: edge.to,
							type: edge.type,
							confidence: edge.confidence,
							source: edge.source,
						});
					}
				}
			}
		}
	}

	// 去重（相同 from→to→type 的边只保留一条，confidence 取最大值）
	const edgeMap = new Map<string, GraphEdge>();
	for (const edge of allEdges) {
		const key = `${edge.from}→${edge.to}→${edge.type}`;
		const existing = edgeMap.get(key);
		if (!existing || (edge.confidence ?? 0) > (existing.confidence ?? 0)) {
			edgeMap.set(key, edge);
		}
	}

	return {
		nodes,
		edges: [...edgeMap.values()],
	};
}

// ─── 查询 ──────────────────────────────────────────────────────────

/** 获取某个节点的所有出边 */
export function getOutgoingEdges(
	graph: GraphData,
	nodeId: string,
): GraphEdge[] {
	return graph.edges.filter((e) => e.from === nodeId);
}

/** 获取某个节点的所有入边 */
export function getIncomingEdges(
	graph: GraphData,
	nodeId: string,
): GraphEdge[] {
	return graph.edges.filter((e) => e.to === nodeId);
}

/** 获取所有与某节点相关的边（出边 + 入边） */
export function getRelatedEdges(graph: GraphData, nodeId: string): GraphEdge[] {
	return graph.edges.filter((e) => e.from === nodeId || e.to === nodeId);
}

/** 按边类型筛选 */
export function getEdgesByType(
	graph: GraphData,
	type: GraphEdge["type"],
): GraphEdge[] {
	return graph.edges.filter((e) => e.type === type);
}

// ─── 健康检查 ──────────────────────────────────────────────────────

/** 检测孤立节点（没有任何边的节点） */
export function findOrphanNodes(graph: GraphData): GraphNode[] {
	const connectedIds = new Set<string>();
	for (const edge of graph.edges) {
		connectedIds.add(edge.from);
		connectedIds.add(edge.to);
	}
	return graph.nodes.filter((n) => !connectedIds.has(n.nodeId));
}

/** 检测矛盾对（contradicts 类型的边） */
export function findContradictions(graph: GraphData): GraphEdge[] {
	return graph.edges.filter((e) => e.type === "contradicts");
}

/** 生成图谱健康统计 */
export function getGraphStats(graph: GraphData): GraphStats {
	const orphans = findOrphanNodes(graph);
	const contradictions = findContradictions(graph);

	const edgeTypeBreakdown: Record<string, number> = {};
	for (const edge of graph.edges) {
		edgeTypeBreakdown[edge.type] = (edgeTypeBreakdown[edge.type] ?? 0) + 1;
	}

	return {
		totalNodes: graph.nodes.length,
		totalEdges: graph.edges.length,
		orphanCount: orphans.length,
		orphanRate:
			graph.nodes.length > 0
				? Math.round((orphans.length / graph.nodes.length) * 100)
				: 0,
		contradictionCount: contradictions.length,
		edgeTypeBreakdown,
	};
}
