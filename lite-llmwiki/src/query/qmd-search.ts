/**
 * qmd-search — qmd 混合搜索提供者
 *
 * 通过 qmd CLI（`qmd query --json`）接入 BM25+Vector+RRF+Rerank 搜索。
 * qmd 未配置/不可用时，自动回退到 KeywordSearchProvider。
 *
 * 依赖：qmd CLI 已安装（npm install -g @tobilu/qmd 或 npx @tobilu/qmd）
 * 配置：用户需先运行 qmd collection add + qmd embed 建立索引
 *
 * 设计决策（架构设计 §13）：
 * - 搜索后端可替换——QmdSearchProvider 和 KeywordSearchProvider 都实现 SearchProvider
 * - engine 的 board 装配逻辑不变（只依赖搜索结果 + 强制注入）
 */

import { execSync } from "node:child_process";
import type { AppConfig, SearchMatchV6 } from "../types.js";
import type {
	SearchOptions,
	SearchProvider,
	SearchResult,
} from "./search-provider.js";
import { type SearchOptions as KeywordOptions, searchWiki } from "./search.js";

// ─── 类型 ──────────────────────────────────────────────────────────

interface QmdResult {
	file: string;
	title?: string;
	score: number;
	snippet?: string;
	docid?: string;
}

// ─── 检测 ──────────────────────────────────────────────────────────

let _qmdAvailable: boolean | null = null;
let _qmdLastCheck = 0;
const QMD_CHECK_TTL_MS = 5 * 60 * 1000; // 5 min

/** 检测 qmd CLI 是否可用 */
function isQmdAvailable(): boolean {
	if (_qmdAvailable !== null && Date.now() - _qmdLastCheck < QMD_CHECK_TTL_MS)
		return _qmdAvailable;
	try {
		execSync("qmd --version", { stdio: "ignore", timeout: 5000 });
		_qmdAvailable = true;
		_qmdLastCheck = Date.now();
	} catch {
		// 尝试 npx
		try {
			execSync("npx @tobilu/qmd --version", {
				stdio: "ignore",
				timeout: 10000,
			});
			_qmdAvailable = true;
			_qmdLastCheck = Date.now();
		} catch {
			_qmdAvailable = false;
			_qmdLastCheck = Date.now();
		}
	}
	return _qmdAvailable;
}

// ─── QmdSearchProvider ─────────────────────────────────────────────

export class QmdSearchProvider implements SearchProvider {
	private fallback: SearchProvider;
	private qmdCommand: string;

	constructor(fallback?: SearchProvider, qmdCommand?: string) {
		this.fallback = fallback ?? {
			search: (config, query, opts) => ({
				matches: searchWiki(config, query, opts as KeywordOptions),
			}),
		};
		this.qmdCommand = qmdCommand ?? "qmd";
	}

	search(
		config: AppConfig,
		query: string,
		options?: SearchOptions,
	): SearchResult {
		// 如果 qmd 不可用，回退到关键词搜索
		if (!isQmdAvailable()) {
			return this.fallback.search(config, query, options);
		}

		const maxResults = options?.maxResults ?? 20;
		const minScore = options?.minScore ?? 0.01;

		try {
			const cmd = `${this.qmdCommand} query ${shellEscape(query)} --json -n ${maxResults} --min-score ${minScore}`;
			const stdout = execSync(cmd, {
				stdio: ["ignore", "pipe", "pipe"],
				timeout: 30000,
				encoding: "utf-8",
			});

			const rawResults = JSON.parse(stdout) as QmdResult[];
			if (!Array.isArray(rawResults) || rawResults.length === 0) {
				// qmd 无结果——不回退，返回空（qmd 认为没有就是没有）
				return { matches: [] };
			}

			const matches: SearchMatchV6[] = rawResults.map((r) => ({
				nodeId:
					r.docid ?? r.file?.replace(/\.md$/, "").replace(/\//g, "/") ?? "",
				kind: "concept", // qmd 不知道 kind，默认 concept
				title:
					r.title ??
					r.file?.split("/").pop()?.replace(/\.md$/, "") ??
					"Untitled",
				score: r.score,
				filePath: r.file ?? "",
				claim: r.snippet ?? "",
				evidence: [],
				interpretation: "",
				limits: [],
				useFor: [],
				sourceIds: [],
				sourceChase: [],
				propRefs: [],
				related: [],
				tags: [],
			}));

			return { matches };
		} catch (err) {
			// qmd 调用失败——回退到关键词搜索
			console.error(
				"[QmdSearchProvider] qmd call failed, falling back to keyword search:",
				(err as Error).message,
			);
			return this.fallback.search(config, query, options);
		}
	}
}

/** shell 参数转义——防止命令注入 */
function shellEscape(s: string): string {
	// 用单引号包裹，内部的单引号转义为 '\''
	return `'${s.replace(/'/g, "'\\''")}'`;
}
