/**
 * search-provider — 搜索接口抽象
 *
 * 将搜索后端与 board 装配解耦。board 通过 SearchProvider 接口获取 seed nodes，
 * 不关心底层是关键词搜索还是 qmd 混合搜索。
 *
 * 设计决策（架构设计 §07 §17#3）：
 * - v1 只用 KeywordSearchProvider（当前 Intl.Segmenter）
 * - 接口定义好但不做配置切换（YAGNI）
 * - qmd 集成时再加 QmdSearchProvider + 配置项
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
 * 搜索提供者接口——board 装配通过此接口获取 seed nodes。
 *
 * 实现者：
 * - KeywordSearchProvider：当前 Intl.Segmenter 关键词搜索（v1 默认）
 * - QmdSearchProvider：qmd BM25+Vector+RRF+Rerank（未来集成）
 */
export interface SearchProvider {
	/** 按 query 搜索 wiki，返回匹配节点列表 */
	search(
		config: AppConfig,
		query: string,
		options?: SearchOptions,
	): SearchResult;
	/** 重建搜索索引（qmd 需要 embed，关键词搜索为空操作） */
	reindex?(config: AppConfig): Promise<void>;
}
