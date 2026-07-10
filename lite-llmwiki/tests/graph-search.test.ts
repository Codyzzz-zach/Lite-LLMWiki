import { describe, it, expect } from "vitest";
import { walkGraph } from "../src/query/graph-search.js";
import type { GraphData } from "../src/knowledge/graph.js";

function makeGraph(edges: GraphData["edges"]): GraphData {
	return {
		nodes: [],
		edges,
		nodeCount: 0,
		edgeCount: edges.length,
	};
}

describe("walkGraph", () => {
	it("空 graph 返回空 map", () => {
		const g = makeGraph([]);
		expect(walkGraph(["a"], g).size).toBe(0);
	});

	it("单 seed 找到 1-hop 邻居", () => {
		const g = makeGraph([
			{ from: "a", to: "b", type: "related", confidence: 0.8 },
		]);
		const scores = walkGraph(["a"], g);
		expect(scores.get("b")).toBe(0.8);
	});

	it("多 seed 邻居——取最高分", () => {
		const g = makeGraph([
			{ from: "a", to: "c", type: "derived_from", confidence: 0.6 },
			{ from: "b", to: "c", type: "related", confidence: 0.9 },
		]);
		const scores = walkGraph(["a", "b"], g);
		expect(scores.get("c")).toBe(0.9); // max of 0.6 and 0.9
	});

	it("跳过 seed 自身", () => {
		const g = makeGraph([
			{ from: "a", to: "b", type: "related", confidence: 0.7 },
		]);
		const scores = walkGraph(["a"], g);
		expect(scores.has("a")).toBe(false);
	});

	it("双向边都可发现邻居（from 或 to 是 seed）", () => {
		const g = makeGraph([
			{ from: "x", to: "a", type: "contradicts", confidence: 0.5 },
			{ from: "a", to: "y", type: "derived_from", confidence: 0.9 },
		]);
		const scores = walkGraph(["a"], g);
		expect(scores.get("x")).toBe(0.5);
		expect(scores.get("y")).toBe(0.9);
	});

	it("confidence 缺失时默认 0.5", () => {
		const g = makeGraph([{ from: "a", to: "b", type: "related", confidence: undefined as unknown as number }]);
		const scores = walkGraph(["a"], g);
		expect(scores.get("b")).toBe(0.5);
	});

	it("多个 seed 的邻居不重复计数", () => {
		const g = makeGraph([
			{ from: "a", to: "c", type: "related", confidence: 0.7 },
			{ from: "d", to: "e", type: "derived_from", confidence: 0.85 },
		]);
		const scores = walkGraph(["a", "d"], g);
		expect(scores.size).toBe(2);
		expect(scores.get("c")).toBe(0.7);
		expect(scores.get("e")).toBe(0.85);
	});
});
