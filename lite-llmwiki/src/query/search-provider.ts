/**
 * search-provider — 搜索接口抽象
 *
 * 将搜索后端与 board 装配解耦。board 通过 SearchProvider 接口获取 seed nodes，
 * 不关心底层是关键词搜索还是 qmd 混合搜索。
 *
 * 设计决策（architecture-design-v2 §05）：
 * - v2: qmd 用作 FTS5 + sqlite-vec 搜索引擎，但不用其 unified search()
 * - searchLex() 和 searchVector() 返回原始排名供三路 RRF 融合
 * - QmdSearchProvider 索引 wiki/ 目录，parseWikiFile() 返回真实节点
 */

import type { AppConfig, SearchMatchV6 } from "../types.js";

export interface SearchOptions {
	maxResults?: number;
	minScore?: number;
	includeFailed?: boolean;
}

export interface SearchResult {
	matches: SearchMatchV6[];
}

/**
 * 扩展的搜索选项——用于 searchLex / searchVector
 */
export interface ProviderSearchOptions extends SearchOptions {
	/** 集合名称（qmd collection） */
	collection?: string;
}

/**
 * 搜索提供者接口——board 装配通过此接口获取 seed nodes。
 *
 * 实现者：
 * - KeywordSearchProvider：当前 Intl.Segmenter 关键词搜索（v2 默认）
 * - QmdSearchProvider：qmd BM25+Vector（v2 可选后端，需先配置 qmd）
 */
export interface SearchProvider {
	/** 按 query 搜索 wiki，返回匹配节点列表（同步，默认后端） */
	search(
		config: AppConfig,
		query: string,
		options?: SearchOptions,
	): SearchResult;

	/**
	 * BM25 关键词搜索——返回原始排名列表（v2，异步，供三路 RRF 融合）。
	 * 对齐 agentmemory hybrid-search：每路独立 rank + 优雅降级。
	 * KeywordSearchProvider 不实现此方法（其 search() 已是 keyword 搜索）——
	 * board 会 fallback 到同步 search()。
	 */
	searchLex?(
		config: AppConfig,
		query: string,
		options?: ProviderSearchOptions,
	): Promise<SearchResult>;

	/**
	 * Vector 语义搜索——返回原始排名列表（v2，异步，供三路 RRF 融合）。
	 * KeywordSearchProvider 不实现此方法（无向量后端）——
	 * board 检测到 undefined 时 Vector 路置空，权重归 0 并重新归一化
	 * （对齐 agentmemory hybrid-search.ts:194-206）。
	 */
	searchVector?(
		config: AppConfig,
		query: string,
		options?: ProviderSearchOptions,
	): Promise<SearchResult>;

	/** 重建搜索索引（qmd 需要 embed，关键词搜索为空操作） */
	reindex?(config: AppConfig): Promise<void>;
}
