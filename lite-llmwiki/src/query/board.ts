/**
 * board — Query Board Builder
 *
 * 把 query mode 实现为 context assembly（plan 8.3-8.6）。
 *
 * mode 装配规则（spec 8.3）：
 * - ask:       top relevant + claim/evidence/limits + minimal extras
 * - trace:     ask + chase excerpts + sourceId/chunkRefs
 * - expand:    seed + related + methods/cases/equations + anchors/questions + light limits
 * - compare:   2+ groups of seeds (按 source/tag 分) + shared tags + bridges
 * - challenge: target + limits + counters + weak evidence + gaps
 * - inspire:   seed + insights/questions/counters/anchors + bridges (Phase 4 完整实现)
 *
 * 输出 QueryBoard（含 BoardInstruction），由 LLM 在该局面上综合推理。
 *
 * 不调 LLM —— 这是确定性的 board 装配层。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getExcerpt } from "../knowledge/chase.js";
import { type GraphData, buildGraph } from "../knowledge/graph.js";
import { WIKI_NODE_DIRS, parseWikiContent } from "../knowledge/wiki-parser.js";
import type {
	AppConfig,
	BoardInstruction,
	BoardMode,
	BoardNode,
	ParsedWikiNode,
	QueryBoard,
	SearchMatchV6,
	SourceExcerpt,
	WikiKind,
} from "../types.js";
import { normalizeBoardMode } from "../types.js";
import type { SearchProvider } from "./search-provider.js";
import { KeywordSearchProvider } from "./search.js";

export interface BuildQueryBoardOptions {
	mode: BoardMode | string;
	maxNodes?: number;
	includeLegacy?: boolean;
	includeFailed?: boolean;
	nodeId?: string;
	source?: string;
	tags?: string[];
	withSource?: boolean;
}

// ─── 主入口 ─────────────────────────────────────────────────────────

export async function buildQueryBoard(
	config: AppConfig,
	question: string,
	options: BuildQueryBoardOptions,
	searchProvider: SearchProvider = new KeywordSearchProvider(),
): Promise<QueryBoard> {
	const mode = normalizeBoardMode(options.mode);
	const maxNodes = options.maxNodes ?? 5;

	// ── 1. 搜索 seed nodes ──
	const seedNodes = await findSeedNodes(
		config,
		question,
		options,
		mode,
		maxNodes,
		searchProvider,
	);

	// ── 2. 收集所有 wiki 节点（按 mode 过滤 kind）──
	// 即使指定了 --node，仍需收集所有节点用于 board 装配（evidence/related/counter/question/tension）
	const allParsed: ParsedWikiNode[] = collectAllNodes(
		config,
		options.includeLegacy ?? false,
		options.includeFailed ?? false,
	);

	// ── 2.5: Graph forced injection ──
	const graph = buildGraph(config);
	const forcedNodes: Map<string, BoardNode> = new Map();
	for (const seed of seedNodes) {
		const relatedEdges = graph.edges.filter(
			(e) => e.from === seed.nodeId || e.to === seed.nodeId,
		);
		for (const edge of relatedEdges) {
			const otherId = edge.from === seed.nodeId ? edge.to : edge.from;
			if (!forcedNodes.has(otherId)) {
				const node = allParsed.find((n) => n.nodeId === otherId);
				if (node) {
					const bn = toBoardNode(node, 0.5); // lower score for forced nodes
					forcedNodes.set(otherId, bn);
				}
			}
		}
	}

	// ── 3. 按 mode 装配各类 node 集合 ──
	const boardNodes = await assembleBoard(
		config,
		mode,
		seedNodes,
		allParsed,
		options,
		forcedNodes,
		graph,
	);

	// ── 4. chase excerpts（trace 模式默认有）──
	const sourceExcerpts =
		mode === "trace" || options.withSource
			? await loadSourceExcerpts(config, boardNodes.seedNodes)
			: [];

	// ── 5. gaps（无覆盖问题）──
	const gaps = buildGaps(question, boardNodes.seedNodes, allParsed);

	// ── 6. BoardInstruction ──
	const instructions = buildInstruction(mode, boardNodes, allParsed);

	return {
		mode,
		question,
		seedNodes: boardNodes.seedNodes,
		evidenceNodes: boardNodes.evidenceNodes,
		relatedNodes: boardNodes.relatedNodes,
		limitNodes: boardNodes.limitNodes,
		counterNodes: boardNodes.counterNodes,
		questionNodes: boardNodes.questionNodes,
		tensionNodes: boardNodes.tensionNodes,
		sourceExcerpts,
		gaps,
		instructions,
	};
}

// ─── 节点搜索 ──────────────────────────────────────────────────────

async function findSeedNodes(
	config: AppConfig,
	question: string,
	options: BuildQueryBoardOptions,
	mode: BoardMode,
	maxNodes: number,
	searchProvider: SearchProvider,
): Promise<BoardNode[]> {
	// 强制 --node 模式：直接定位指定 node
	if (options.nodeId) {
		const node = loadNodeById(config, options.nodeId);
		return node ? [toBoardNode(node, 1.0)] : [];
	}

	// 常规搜索（通过 SearchProvider 接口）
	// 不显式覆盖 minScore（用默认值 0.01）—— score 0 的节点不应该进 board
	const result = searchProvider.search(config, question, {
		maxResults: maxNodes,
	});
	const matches = result.matches;
	let seeds = matches.map((m) => matchToBoardNode(m));

	// --source 过滤
	if (options.source) {
		seeds = seeds.filter((n) =>
			n.sourceIds.some((s) => s.includes(options.source!)),
		);
	}

	// compare 模式：按 sourceId 分组
	if (mode === "compare") {
		// 已经过滤过；保留所有
	}

	return seeds;
}

function collectAllNodes(
	config: AppConfig,
	includeLegacy: boolean,
	includeFailed = false,
): ParsedWikiNode[] {
	const nodes: ParsedWikiNode[] = [];
	for (const dir of WIKI_NODE_DIRS) {
		const dirPath = join(config.wikiDir, dir);
		if (!existsSync(dirPath)) continue;
		for (const f of readdirSync(dirPath)) {
			if (!f.endsWith(".md")) continue;
			const fullPath = join(dirPath, f);
			let content: string;
			try {
				content = readFileSync(fullPath, "utf-8");
			} catch {
				continue;
			}
			const node = parseWikiContent(content, fullPath);
			if (!includeLegacy && node.isLegacy) continue;
			if (!includeFailed && node.frontmatter.auditStatus === "failed") continue;
			nodes.push(node);
		}
	}
	return nodes;
}

function loadNodeById(
	config: AppConfig,
	nodeId: string,
): ParsedWikiNode | null {
	for (const dir of WIKI_NODE_DIRS) {
		const dirPath = join(config.wikiDir, dir);
		if (!existsSync(dirPath)) continue;
		for (const f of readdirSync(dirPath)) {
			if (!f.endsWith(".md")) continue;
			const fullPath = join(dirPath, f);
			let content: string;
			try {
				content = readFileSync(fullPath, "utf-8");
			} catch {
				continue;
			}
			const node = parseWikiContent(content, fullPath);
			if (node.nodeId === nodeId) return node;
		}
	}
	return null;
}

// ─── Board 装配（按 mode 分支）──────────────────────────────────

interface AssembledBoard {
	seedNodes: BoardNode[];
	evidenceNodes: BoardNode[];
	relatedNodes: BoardNode[];
	limitNodes: BoardNode[];
	counterNodes: BoardNode[];
	questionNodes: BoardNode[];
	tensionNodes: BoardNode[];
}

async function assembleBoard(
	config: AppConfig,
	mode: BoardMode,
	seeds: BoardNode[],
	allParsed: ParsedWikiNode[],
	options: BuildQueryBoardOptions,
	forcedNodes: Map<string, BoardNode>,
	graph: GraphData,
): Promise<AssembledBoard> {
	const allBoardNodes = allParsed.map((n) => toBoardNode(n, 0));
	const seedIds = new Set(seeds.map((s) => s.nodeId));

	const empty = {
		seedNodes: [],
		evidenceNodes: [],
		relatedNodes: [],
		limitNodes: [],
		counterNodes: [],
		questionNodes: [],
		tensionNodes: [],
	};
	let result: AssembledBoard = empty;

	switch (mode) {
		case "ask": {
			// seeds 之外，按 shared sourceIds 找 evidence nodes
			const evidenceNodes = pickEvidence(
				seeds,
				allBoardNodes,
				seedIds,
				/* max */ 5,
			);
			const relatedNodes = pickRelated(
				seeds,
				allBoardNodes,
				seedIds,
				/* max */ 3,
			);
			const limitNodes = seeds.filter((n) => n.limits.length > 0);
			const counterNodes = allBoardNodes
				.filter((n) => n.kind === "counter" && !seedIds.has(n.nodeId))
				.slice(0, 2);
			const questionNodes = allBoardNodes
				.filter((n) => n.kind === "question" && !seedIds.has(n.nodeId))
				.slice(0, 2);
			result = {
				seedNodes: seeds,
				evidenceNodes,
				relatedNodes,
				limitNodes,
				counterNodes,
				questionNodes,
				tensionNodes: [],
			};
			break;
		}

		case "trace": {
			// trace: seeds 优先 + 它们的 evidence（full）+ shared sourceIds
			const evidenceNodes = pickEvidence(
				seeds,
				allBoardNodes,
				seedIds,
				/* max */ 10,
			);
			const relatedNodes = pickRelated(
				seeds,
				allBoardNodes,
				seedIds,
				/* max */ 5,
			);
			const limitNodes = seeds.filter((n) => n.limits.length > 0);
			const counterNodes = allBoardNodes
				.filter((n) => n.kind === "counter" && !seedIds.has(n.nodeId))
				.slice(0, 3);
			const questionNodes = allBoardNodes
				.filter((n) => n.kind === "question" && !seedIds.has(n.nodeId))
				.slice(0, 3);
			result = {
				seedNodes: seeds,
				evidenceNodes,
				relatedNodes,
				limitNodes,
				counterNodes,
				questionNodes,
				tensionNodes: [],
			};
			break;
		}

		case "expand": {
			// expand: 包含 methods/cases/equations（按 tag/source 共享）作为 relatedNodes
			const evidenceNodes = pickEvidence(
				seeds,
				allBoardNodes,
				seedIds,
				/* max */ 5,
			);
			const relatedKinds: WikiKind[] = ["method", "case", "equation"];
			const seedTags = new Set(seeds.flatMap((s) => s.tags));
			const seedSourceIds = new Set(seeds.flatMap((s) => s.sourceIds));
			const relatedNodes = allBoardNodes
				.filter((n) => relatedKinds.includes(n.kind) && !seedIds.has(n.nodeId))
				.filter(
					(n) =>
						n.tags.some((t) => seedTags.has(t)) ||
						n.sourceIds.some((s) => seedSourceIds.has(s)),
				)
				.slice(0, 6);
			// anchors / questions
			const questionNodes = allBoardNodes
				.filter((n) => n.kind === "question" || n.kind === "anchor")
				.slice(0, 4);
			const limitNodes = seeds.filter((n) => n.limits.length > 0).slice(0, 2);
			const counterNodes: BoardNode[] = []; // expand 不引入 counter（让用户保持开放）
			result = {
				seedNodes: seeds,
				evidenceNodes,
				relatedNodes,
				limitNodes,
				counterNodes,
				questionNodes,
				tensionNodes: [],
			};
			break;
		}

		case "compare": {
			// compare: 按 sourceIds 分组形成多组；保留所有 seeds
			const evidenceNodes = pickEvidence(
				seeds,
				allBoardNodes,
				seedIds,
				/* max */ 5,
			);
			const relatedNodes = pickBridgeNodes(seeds, allBoardNodes, seedIds);
			const limitNodes = seeds.filter((n) => n.limits.length > 0);
			const counterNodes: BoardNode[] = [];
			const questionNodes: BoardNode[] = [];
			result = {
				seedNodes: seeds,
				evidenceNodes,
				relatedNodes,
				limitNodes,
				counterNodes,
				questionNodes,
				tensionNodes: [],
			};
			break;
		}

		case "challenge": {
			// challenge: 目标 seed + 所有 limit + 所有 counter
			const evidenceNodes = pickWeakEvidence(seeds, allBoardNodes, seedIds);
			const relatedNodes: BoardNode[] = [];
			const limitNodes = allBoardNodes
				.filter((n) => n.limits.length > 0)
				.slice(0, 10);
			const counterNodes = allBoardNodes
				.filter((n) => n.kind === "counter")
				.slice(0, 5);
			const questionNodes = allBoardNodes
				.filter((n) => n.kind === "question")
				.slice(0, 3);
			result = {
				seedNodes: seeds,
				evidenceNodes,
				relatedNodes,
				limitNodes,
				counterNodes,
				questionNodes,
				tensionNodes: [],
			};
			break;
		}

		case "inspire": {
			// inspire: seed + evidence + related (cross-kind) + counters + questions + tension nodes
			// spec 8.8: seed + weakly related + insights + questions + counters + anchors + bridges + recent
			const evidenceNodes = pickEvidence(seeds, allBoardNodes, seedIds, 5);

			// cross-kind related: insight/question/counter/anchor (by tag/source shared)
			const inspireKinds: WikiKind[] = [
				"insight",
				"question",
				"counter",
				"anchor",
			];
			const seedTags = new Set(seeds.flatMap((s) => s.tags));
			const seedSourceIds = new Set(seeds.flatMap((s) => s.sourceIds));
			const relatedNodes = allBoardNodes
				.filter((n) => inspireKinds.includes(n.kind) && !seedIds.has(n.nodeId))
				.filter(
					(n) =>
						n.tags.some((t) => seedTags.has(t)) ||
						n.sourceIds.some((s) => seedSourceIds.has(s)),
				)
				.slice(0, 6);

			const limitNodes = seeds.filter((n) => n.limits.length > 0).slice(0, 3);
			const counterNodes = allBoardNodes
				.filter((n) => n.kind === "counter")
				.slice(0, 5);
			const questionNodes = allBoardNodes
				.filter((n) => n.kind === "question")
				.slice(0, 4);

			// tension nodes: 语义失败但有 claim 的节点 — inspire 的张力素材
			// 区分"语义失败"（有 claim，超 evidence → tension）vs"结构失败"（无 chase/evidence → 不参与）
			const tensionNodes = allBoardNodes
				.filter((n) => n.auditStatus === "failed" && n.claim.length > 0)
				.slice(0, 5);

			result = {
				seedNodes: seeds,
				evidenceNodes,
				relatedNodes,
				limitNodes,
				counterNodes,
				questionNodes,
				tensionNodes,
			};
			break;
		}
	}

	// ── Append forced nodes based on edge type ──
	for (const [nodeId, boardNode] of forcedNodes) {
		if (seedIds.has(nodeId)) continue; // already a seed
		// Find edges connecting this node to any seed
		const connectingEdges = graph.edges.filter(
			(e) =>
				(e.from === nodeId && seedIds.has(e.to)) ||
				(e.to === nodeId && seedIds.has(e.from)),
		);
		for (const edge of connectingEdges) {
			switch (edge.type) {
				case "contradicts":
					if (!result.counterNodes.some((n) => n.nodeId === nodeId)) {
						result.counterNodes.push(boardNode);
					}
					break;
				case "derived_from":
				case "supports":
				case "relates_to":
				case "superseded_by":
					if (!result.relatedNodes.some((n) => n.nodeId === nodeId)) {
						result.relatedNodes.push(boardNode);
					}
					break;
			}
		}
	}

	return result;
}

// ─── 节点挑选辅助 ──────────────────────────────────────────────────

function pickEvidence(
	seeds: BoardNode[],
	pool: BoardNode[],
	seedIds: Set<string>,
	max: number,
): BoardNode[] {
	const seedSourceIds = new Set(seeds.flatMap((s) => s.sourceIds));
	const seedTags = new Set(seeds.flatMap((s) => s.tags));
	return pool
		.filter((n) => !seedIds.has(n.nodeId))
		.filter(
			(n) =>
				n.sourceIds.some((s) => seedSourceIds.has(s)) ||
				n.tags.some((t) => seedTags.has(t)),
		)
		.slice(0, max);
}

function pickRelated(
	seeds: BoardNode[],
	pool: BoardNode[],
	seedIds: Set<string>,
	max: number,
): BoardNode[] {
	const seedTags = new Set(seeds.flatMap((s) => s.tags));
	// BoardNode 不含 `related` 字段；用 `related` 匹配需要从 ParsedWikiNode
	// 这里是简化版：只用 tag 匹配（避免在 BoardNode 上加 dead field）
	return pool
		.filter((n) => !seedIds.has(n.nodeId))
		.filter((n) => n.tags.some((t) => seedTags.has(t)))
		.slice(0, max);
}

function pickBridgeNodes(
	seeds: BoardNode[],
	pool: BoardNode[],
	seedIds: Set<string>,
): BoardNode[] {
	// bridges: 共享 tag 但来自不同 source
	const seedSourceIds = new Set(seeds.flatMap((s) => s.sourceIds));
	const seedTags = new Set(seeds.flatMap((s) => s.tags));
	return pool
		.filter((n) => !seedIds.has(n.nodeId))
		.filter((n) => n.tags.some((t) => seedTags.has(t)))
		.filter((n) => n.sourceIds.some((s) => !seedSourceIds.has(s)))
		.slice(0, 5);
}

function pickWeakEvidence(
	seeds: BoardNode[],
	pool: BoardNode[],
	seedIds: Set<string>,
): BoardNode[] {
	// weak evidence: 共享 source 但 evidence 短
	const seedSourceIds = new Set(seeds.flatMap((s) => s.sourceIds));
	return pool
		.filter((n) => !seedIds.has(n.nodeId))
		.filter((n) => n.sourceIds.some((s) => seedSourceIds.has(s)))
		.filter((n) => n.evidence.length <= 1)
		.slice(0, 5);
}

// ─── Chase excerpts ─────────────────────────────────────────────────

async function loadSourceExcerpts(
	config: AppConfig,
	nodes: BoardNode[],
): Promise<SourceExcerpt[]> {
	const excerpts: SourceExcerpt[] = [];
	for (const n of nodes) {
		if (n.sourceChase.length === 0 || n.propRefs.length === 0) continue;
		try {
			const exs = getExcerpt(
				config,
				n.sourceChase,
				n.propRefs.map(Number).filter((num) => !isNaN(num)),
			);
			for (const ex of exs) {
				excerpts.push({
					sourceId: n.sourceIds[0] ?? n.nodeId,
					sourceChase: n.sourceChase[0] ?? "",
					propRefs: [String(ex.index)],
					text: ex.text,
				});
			}
		} catch {
			// chase 缺失时跳过
		}
	}
	return excerpts;
}

// ─── Gaps ──────────────────────────────────────────────────────────

function buildGaps(
	question: string,
	seeds: BoardNode[],
	allNodes: ParsedWikiNode[],
): QueryBoard["gaps"] {
	if (seeds.length === 0) {
		return [
			{
				question,
				reason:
					allNodes.length === 0
						? "wiki is empty"
						: "no wiki node matches this question",
			},
		];
	}
	// 简化：seed 匹配时，gaps 关注尚未被覆盖的方面
	// 当前实现：seed 非空时 gaps 为空（让 mode-specific assembler 处理）
	return [];
}

// ─── BoardInstruction ──────────────────────────────────────────────

function buildInstruction(
	mode: BoardMode,
	board: AssembledBoard,
	allNodes: ParsedWikiNode[],
): BoardInstruction {
	const totalNodes = allNodes.length;
	const summary = `seed=${board.seedNodes.length}, evidence=${board.evidenceNodes.length}, related=${board.relatedNodes.length}, counter=${board.counterNodes.length}, tension=${board.tensionNodes.length}`;

	let synthesisLevel: BoardInstruction["synthesisLevel"] = "anchored";
	const boundaries: BoardInstruction["outputBoundaries"] = {
		requireLayeredOutput: true,
		requirePropRef: false,
		requireEvidenceBoundary: true,
	};

	switch (mode) {
		case "ask":
			synthesisLevel = "anchored";
			break;
		case "trace":
			synthesisLevel = "strict";
			boundaries.requirePropRef = true;
			break;
		case "expand":
			synthesisLevel = "free";
			break;
		case "compare":
			synthesisLevel = "anchored";
			break;
		case "challenge":
			synthesisLevel = "strict";
			break;
		case "inspire":
			synthesisLevel = "free";
			boundaries.requireLayeredOutput = false;
			break;
	}

	return {
		mode,
		boardSummary: summary,
		synthesisLevel,
		outputBoundaries: boundaries,
		coverageNote:
			board.seedNodes.length === 0
				? totalNodes === 0
					? "wiki is empty"
					: "no node matches"
				: undefined,
	};
}

// ─── 类型转换 ─────────────────────────────────────────────────────

function matchToBoardNode(m: SearchMatchV6): BoardNode {
	return {
		nodeId: m.nodeId,
		kind: m.kind,
		title: m.title,
		filePath: m.filePath,
		claim: m.claim,
		evidence: m.evidence,
		interpretation: m.interpretation,
		limits: m.limits,
		tags: m.tags,
		sourceIds: m.sourceIds,
		sourceChase: m.sourceChase,
		propRefs: m.propRefs,
		auditStatus: m.auditStatus,
		auditScore: m.auditScore,
		boardRoles: [],
		score: m.score,
	};
}

function toBoardNode(node: ParsedWikiNode, score: number): BoardNode {
	const fm = node.frontmatter;
	return {
		nodeId: node.nodeId,
		kind: node.kind,
		title: node.title,
		filePath: node.filePath,
		claim: node.sections.claim,
		evidence: node.sections.evidence,
		interpretation: node.sections.interpretation,
		limits: node.sections.limits,
		tags: fm.tags ?? [],
		sourceIds: fm.sourceIds ?? [],
		sourceChase: fm.sourceChase ?? [],
		propRefs: fm.propRefs ?? [],
		auditStatus: fm.auditStatus,
		auditScore: fm.auditScore,
		boardRoles: fm.boardRoles ?? [],
		score,
	};
}
