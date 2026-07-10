/**
 * rrf — Reciprocal Rank Fusion（三路）
 *
 * 将 BM25 rank + Vector rank + Graph rank 融合为单一排名。
 * 公式对齐 agentmemory hybrid-search.ts 第 216-218 行——三路统一用
 * `weight / (K + rank)` 形式，同量纲，graph 不会因 score 量纲压过语义 seed。
 *
 * 权重（对齐 agentmemory hybrid-search.ts:30-32 构造函数默认值）:
 *   BM25   = 0.4 （关键词匹配）
 *   Vector = 0.6 （语义相似度）
 *   Graph  = 0.3 （结构关联）
 *
 * K = 60（标准 RRF 参数）
 *
 * 同量纲的意义（Finding 1 修复）：
 * - 旧实现 graph 路用 `0.3 * score`（score 0-1），graph 邻居最高 0.3，
 *   而语义 seed 是 `0.4/(K+1)+0.6/(K+1)≈0.016`——graph 邻居会压过 seed。
 * - 改成 `0.3/(K+graphRank)` 后，graph 第1名 = 0.3/61 ≈ 0.0049，
 *   低于 BM25 第1名（0.0066）和 Vector 第1名（0.0098）。
 *   graph 邻居天然排不进前几名，但能进中后段——既不泛滥也不消失。
 *
 * 优雅降级（对齐 agentmemory hybrid-search.ts:194-206）：
 * - 某路缺失时，调用方传入空 RankMap（而非伪造等于另一路）。
 * - 空 Map 中每个 id 的 rank = Infinity（见 `?? Infinity`），
 *   于是 `weight / (K + Infinity) = 0`，该路自然贡献 0 分。
 * - 例：Vector 后端不存在 → vectorRanks = 空 Map → Vector 贡献 0，
 *   等效「BM25(0.4) + Graph(0.3) 两路」，相对比例 0.4:0.3 保持不变。
 */

const K = 60;

/** nodeId → rank（1-based，越小越好）或 nodeId → score（0-1，越大越好） */
type RankMap = Map<string, number>;

/**
 * 三路 RRF 融合（三路统一用 weight/(K+rank) 形式，对齐 agentmemory）
 * @param bm25Ranks   BM25 排名——nodeId → rank（1-based）。空 Map 表示无 BM25 路。
 * @param vectorRanks Vector 排名——nodeId → rank（1-based）。空 Map 表示无 Vector 路（降级）。
 * @param graphRanks  Graph 排名——nodeId → rank（1-based，由 walkGraph score 转换）。空 Map 表示无 Graph 路。
 * @returns nodeId → combinedScore（越大越好）
 */
export function rrfFusion(
	bm25Ranks: RankMap,
	vectorRanks: RankMap,
	graphRanks: RankMap,
): RankMap {
	const allIds = new Set([
		...bm25Ranks.keys(),
		...vectorRanks.keys(),
		...graphRanks.keys(),
	]);

	const scores = new Map<string, number>();

	for (const id of allIds) {
		const br = bm25Ranks.get(id) ?? Infinity;
		const vr = vectorRanks.get(id) ?? Infinity;
		const gr = graphRanks.get(id) ?? Infinity;

		// agentmemory 公式：weight / (K + rank)，三路同形式
		// 缺失路 rank=Infinity → 该项=0（优雅降级）
		scores.set(
			id,
			0.4 / (K + br) + // BM25: keyword matching
			0.6 / (K + vr) + // Vector: semantic similarity
			0.3 / (K + gr),  // Graph: structural relevance
		);
	}

	return scores;
}

/**
 * 将 score map（nodeId → 0-1 score，越大越好）转换为 rank map
 * （nodeId → 1-based rank，越小越好）。按 score 降序排，第1名 rank=1。
 *
 * 用于把 walkGraph 返回的 score 转成 RRF 所需的 rank。
 */
export function scoresToRanks(scoreMap: RankMap): RankMap {
	const ranked = [...scoreMap.entries()].sort((a, b) => b[1] - a[1]);
	const ranks = new Map<string, number>();
	ranked.forEach(([id], i) => ranks.set(id, i + 1));
	return ranks;
}

/**
 * 将 score map 按分数降序排列，返回 nodeId 列表
 */
export function rankByScore(scores: RankMap): string[] {
	return [...scores.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([id]) => id);
}
