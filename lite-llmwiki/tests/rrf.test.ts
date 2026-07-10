import { describe, it, expect } from "vitest";
import { rrfFusion, rankByScore, scoresToRanks } from "../src/query/rrf.js";

// 注意：rrfFusion 三路参数都是 rank（1-based，越小越好），不再是 score。
// graph 路 rank 由 walkGraph 的 score 经 scoresToRanks 转换得到。
// 三路统一 weight/(K+rank) 形式，同量纲（Finding 1 修复，对齐 agentmemory）。

describe("rrfFusion", () => {
	it("三路全有——正确融合", () => {
		const bm25 = new Map([["a", 1], ["b", 2], ["c", 3]]);
		const vec = new Map([["a", 2], ["b", 1], ["c", 3]]);
		const graph = new Map([["a", 1], ["c", 2]]); // rank

		const result = rrfFusion(bm25, vec, graph);
		// a: 0.4/61 + 0.6/62 + 0.3/61
		// b: 0.4/62 + 0.6/61 + 0 (graph 无)
		// c: 0.4/63 + 0.6/63 + 0.3/62
		expect(result.get("a")).toBeGreaterThan(result.get("b")!);
		expect(result.get("a")).toBeGreaterThan(result.get("c")!);
	});

	it("仅 BM25 有结果——不加分也不扣分", () => {
		const bm25 = new Map([["x", 1]]);
		const vec = new Map<string, number>();
		const graph = new Map<string, number>();

		const result = rrfFusion(bm25, vec, graph);
		expect(result.get("x")).toBeCloseTo(0.4 / 61, 4);
	});

	it("Vector 路 空 Map 降级——不等于 Vector=BM25 假三路（修复核心）", () => {
		// Vector 不存在 → vectorRanks 空 Map → vr=Infinity → Vector 贡献 0，
		// 等效 BM25(0.4) + Graph(0.3) 两路。假三路会让 BM25 权重双倍计。
		const bm25 = new Map([["a", 1]]);
		const graph = new Map([["a", 1]]); // rank 1
		const vecEmpty = new Map<string, number>();
		const vecFake = new Map(bm25); // 假三路：vec=bm25

		const degraded = rrfFusion(bm25, vecEmpty, graph);
		const fake = rrfFusion(bm25, vecFake, graph);

		// 降级：a = 0.4/61 + 0 + 0.3/61
		expect(degraded.get("a")).toBeCloseTo(0.4 / 61 + 0.3 / 61, 4);
		// 假三路：a = 0.4/61 + 0.6/61 + 0.3/61（BM25 权重被双倍计）
		expect(fake.get("a")).toBeCloseTo(0.4 / 61 + 0.6 / 61 + 0.3 / 61, 4);
		// 两者必须不同——证明降级不是假三路
		expect(degraded.get("a")).not.toBeCloseTo(fake.get("a")!, 4);
	});

	it("仅 Graph 有结果——正常处理", () => {
		const bm25 = new Map<string, number>();
		const vec = new Map<string, number>();
		const graph = new Map([["z", 1]]); // rank 1

		const result = rrfFusion(bm25, vec, graph);
		// z = 0 + 0 + 0.3/61
		expect(result.get("z")).toBeCloseTo(0.3 / 61, 4);
	});

	it("graph 同量纲——graph 第1名不压过 BM25+Vector 第1名（Finding 1 核心）", () => {
		// 旧公式 graph 用 0.3*score，graph 邻居最高 0.3，压过 seed 的 0.016。
		// 新公式 graph 用 0.3/(K+rank)，graph 第1名 = 0.3/61 ≈ 0.0049，
		// 低于 BM25+Vector 双第1的 seed (0.4/61 + 0.6/61 ≈ 0.0163)。
		const bm25 = new Map([["seed", 1]]);
		const vec = new Map([["seed", 1]]);
		const graph = new Map([["neighbor", 1]]); // graph 第1名

		const result = rrfFusion(bm25, vec, graph);
		const seedScore = result.get("seed")!;
		const neighborScore = result.get("neighbor")!;

		// seed（BM25+Vector 双第1）必须高于 graph-only 邻居（graph 第1）
		expect(seedScore).toBeGreaterThan(neighborScore);
		// graph 第1名封顶 0.3/61
		expect(neighborScore).toBeCloseTo(0.3 / 61, 4);
		// seed = 0.4/61 + 0.6/61
		expect(seedScore).toBeCloseTo(0.4 / 61 + 0.6 / 61, 4);
	});

	it("空三路返回空", () => {
		const result = rrfFusion(new Map(), new Map(), new Map());
		expect(result.size).toBe(0);
	});

	it("rankByScore 降序排列", () => {
		const scores = new Map([["a", 0.1], ["b", 0.9], ["c", 0.5]]);
		const ranked = rankByScore(scores);
		expect(ranked).toEqual(["b", "c", "a"]);
	});

	it("scoresToRanks——score 降序转 1-based rank", () => {
		// walkGraph 返回 score（0-1，越大越好），转成 rank（1-based，越小越好）
		const scores = new Map([["a", 0.9], ["b", 0.5], ["c", 0.3]]);
		const ranks = scoresToRanks(scores);
		expect(ranks.get("a")).toBe(1); // 最高分 → rank 1
		expect(ranks.get("b")).toBe(2);
		expect(ranks.get("c")).toBe(3);
	});

	it("scoresToRanks 空 map 返回空", () => {
		const ranks = scoresToRanks(new Map());
		expect(ranks.size).toBe(0);
	});
});
