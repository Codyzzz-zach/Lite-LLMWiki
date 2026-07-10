/**
 * graph-search — Graph traversal for three-way search
 *
 * Provides walkGraph() as the third search path in three-way RRF fusion.
 * Walks 1-hop from seed nodes, scoring neighbors by edge confidence.
 *
 * Scoring formula (aligned with agentmemory graph-retrieval.ts):
 *   score = avgConfidence × (1 / pathLength)
 *   where pathLength = 1 (only 1-hop traversal),
 *   and avgConfidence = edge.confidence ?? 0.5
 *
 * Design decisions (architecture-design-v2 §07):
 * - 1-hop only — no Dijkstra BFS needed (our edges have no intermediate weights)
 * - confidence-based scoring — NOT hardcoded per-type scores
 *   (contradicts confidence comes from LLM judge,
 *    derived_from/related confidence comes from compile LLM)
 * - Take max score when multiple seeds connect to the same neighbor
 *   (aligned with agentmemory's expandFromChunks logic)
 */

import type { GraphData } from "../knowledge/graph.js";

/** Walk 1-hop from seed nodes, return neighborId → score map */
export function walkGraph(
	seedIds: string[],
	graph: GraphData,
): Map<string, number> {
	const scores = new Map<string, number>();
	const seedSet = new Set(seedIds);

	for (const edge of graph.edges) {
		const fromSeed = seedSet.has(edge.from);
		const toSeed = seedSet.has(edge.to);
		if (!fromSeed && !toSeed) continue; // not connected to any seed

		const neighborId = fromSeed ? edge.to : edge.from;
		if (seedSet.has(neighborId)) continue; // skip seeds themselves

		const confidence = edge.confidence ?? 0.5;
		// pathLength = 1 for 1-hop traversal
		const score = confidence * (1 / 1);

		// Take max score (not sum) — aligned with agentmemory
		const current = scores.get(neighborId) ?? 0;
		if (score > current) scores.set(neighborId, score);
	}

	return scores;
}
