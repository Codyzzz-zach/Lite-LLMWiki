/**
 * qmd-search — qmd 混合搜索提供者（v2 重写）
 *
 * 通过 qmd SDK（`createStore()`）接入 BM25+Vector 搜索。
 * 分别暴露 searchLex() 和 searchVector() 供三路 RRF 融合使用。
 *
 * v2 变更（architecture-design-v2 §05）：
 * - 改用 qmd SDK（替代 CLI execSync）
 * - 索引 wiki/ 目录（替代 raw/）
 * - 搜索结果通过 parseWikiFile() 解析真实节点（替代硬编码假节点）
 * - 不用 qmd unified search()——要原始排名，自己三路 RRF
 *
 * 依赖：npm install @tobilu/qmd
 * 配置：qmd collection add wiki/ --name litewiki + qmd embed -c litewiki
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig, SearchMatchV6 } from "../types.js";
import { parseWikiContent, WIKI_NODE_DIRS } from "../knowledge/wiki-parser.js";
import type {
	ProviderSearchOptions,
	SearchOptions,
	SearchProvider,
	SearchResult,
} from "./search-provider.js";
import { type SearchOptions as KeywordOptions, searchWiki } from "./search.js";

// ─── 类型 ──────────────────────────────────────────────────────────

import type { SearchResult as QmdSearchResult } from "@tobilu/qmd";

interface QmdStore {
	searchLex(query: string, limit?: number, collection?: string): Promise<QmdSearchResult[]>;
	searchVector(query: string, limit?: number, collection?: string): Promise<QmdSearchResult[]>;
}

// ─── 检测与 SDK 加载 ───────────────────────────────────────────────

let _qmdStore: QmdStore | null = null;
let _qmdStoreErrorAt = 0; // 上次失败的时间戳（0 = 未失败）；Finding 6: TTL 重试
const QMD_RETRY_MS = 5 * 60 * 1000; // 5 分钟后允许重试（daemon 长跑自愈）

/**
 * 尝试加载 qmd SDK——懒加载，避免 qmd 不可用时阻塞启动。
 * Finding 6：失败后不永久缓存——5 分钟后允许重试，
 * 让 daemon 长跑进程能在用户之后配置好 qmd 时自愈。
 */
async function getQmdStore(): Promise<QmdStore | null> {
	if (_qmdStore) return _qmdStore;
	// 失败缓存带 TTL：未到 5 分钟不重试，到了清空允许重试
	if (_qmdStoreErrorAt > 0 && Date.now() - _qmdStoreErrorAt < QMD_RETRY_MS) {
		return null;
	}

	try {
		const { createStore } = await import("@tobilu/qmd");
		const dbPath = join(process.cwd(), '.qmd', 'store.sqlite');
		const store = await createStore({ dbPath });
		_qmdStore = {
			searchLex: (q, l, c) => store.searchLex(q, { limit: l, collection: c }),
			searchVector: (q, l, c) => store.searchVector(q, { limit: l, collection: c }),
		};
		_qmdStoreErrorAt = 0; // 成功则清失败标记
		return _qmdStore;
	} catch (err) {
		_qmdStoreErrorAt = Date.now(); // 记录失败时间，TTL 后可重试
		return null;
	}
}

/** 将 qmd 结果文件路径解析为真实的 BoardNode */
function resolveWikiNode(
	filePath: string,
	score: number,
	wikiDir: string,
): SearchMatchV6 | null {
	// qmd 可能返回相对路径如 "wiki/concepts/x.md" 或绝对路径
	const absPath = filePath.startsWith("/") ? filePath : join(wikiDir, "..", filePath);
	if (!existsSync(absPath)) return null;

	try {
		const content = readFileSync(absPath, "utf-8");
		const relPath = absPath.replace(wikiDir + "/", "wiki/");
		const parsed = parseWikiContent(content, relPath);
		const fm = parsed.frontmatter;

		return {
			nodeId: fm.nodeId ?? "",
			kind: fm.kind ?? "concept",
			title: fm.title ?? "",
			score,
			filePath: relPath,
			claim: parsed.sections.claim ?? "",
			evidence: [],
			interpretation: "",
			limits: [],
			useFor: [],
			sourceIds: fm.sourceIds ?? [],
			sourceChase: fm.sourceChase ?? [],
			propRefs: fm.propRefs ?? [],
			related: fm.related ?? [],
			tags: fm.tags ?? [],
		};
	} catch {
		return null;
	}
}

// ─── QmdSearchProvider ─────────────────────────────────────────────

export class QmdSearchProvider implements SearchProvider {
	private fallback: SearchProvider;

	constructor(fallback?: SearchProvider) {
		this.fallback = fallback ?? {
			search: (config, query, opts) => ({
				matches: searchWiki(config, query, opts as KeywordOptions),
			}),
		};
	}

	/**
	 * 默认搜索（同步）——走 fallback keyword 搜索。
	 * qmd 的真 BM25/Vector 排名通过异步 searchLex/searchVector 获取（供三路 RRF）。
	 * search() 保留 fallback（BM25 路 = keyword 是设计，§05「默认仍用 keyword search」）。
	 */
	search(
		config: AppConfig,
		query: string,
		options?: SearchOptions,
	): SearchResult {
		return this.fallback.search(config, query, options);
	}

	/**
	 * BM25 关键词搜索——返回原始排名（异步，供三路 RRF 融合）。
	 * Finding 4：qmd 不可用时返回空（不 fallback keyword）——
	 * BM25 路若 fallback 会用 keyword 冒充 BM25，扭曲 RRF 权重。
	 * board 的 BM25 路本就走同步 search()（keyword），searchLex 只在显式调用时生效。
	 */
	async searchLex(
		config: AppConfig,
		query: string,
		options?: ProviderSearchOptions,
	): Promise<SearchResult> {
		const store = await getQmdStore();
		if (!store) return { matches: [] };

		const limit = options?.maxResults ?? 20;
		const collection = options?.collection ?? "litewiki";
		const rawResults = await store.searchLex(query, limit * 2, collection);

		const matches = this.resolveResults(rawResults, config.wikiDir);
		return { matches: matches.slice(0, limit) };
	}

	/**
	 * Vector 语义搜索——返回原始排名（异步，供三路 RRF 融合）。
	 * Finding 4：qmd 不可用时返回空（不 fallback keyword）——
	 * Vector 路 fallback 会用 keyword 冒充 Vector，破坏降级保证
	 * （Vector 路该空→贡献 0，fallback 反而贡献假数据）。
	 */
	async searchVector(
		config: AppConfig,
		query: string,
		options?: ProviderSearchOptions,
	): Promise<SearchResult> {
		const store = await getQmdStore();
		if (!store) return { matches: [] };

		const limit = options?.maxResults ?? 20;
		const collection = options?.collection ?? "litewiki";
		const rawResults = await store.searchVector(query, limit * 2, collection);

		const matches = this.resolveResults(rawResults, config.wikiDir);
		return { matches: matches.slice(0, limit) };
	}

	private resolveResults(
		raw: QmdSearchResult[],
		wikiDir: string,
	): SearchMatchV6[] {
		const matches: SearchMatchV6[] = [];
		for (const r of raw) {
			const node = resolveWikiNode(r.filepath, r.score, wikiDir);
			if (node) matches.push(node);
		}
		return matches;
	}
}
