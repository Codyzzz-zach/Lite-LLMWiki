/**
 * search — 本地结构化检索，不依赖 LLM
 *
 * 从 wiki/ 读取 v5 / v4 页面，解析 frontmatter 和 body sections，
 * 按字段权重打分返回匹配节点。
 *
 * v6 扩展（plan 8.7）：返回 SearchMatchV6，包含 interpretation / limits / useFor /
 * sourceIds / sourceChase / chunkRefs / related / tags / auditStatus / auditScore。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { WIKI_NODE_DIRS, parseWikiContent } from "../knowledge/wiki-parser.js";
import type {
	AppConfig,
	AuditStatus,
	SearchMatchV6,
	WikiKind,
} from "../types.js";
import type {
	SearchOptions as ProviderSearchOptions,
	SearchProvider,
	SearchResult,
} from "./search-provider.js";

// ─── 公开类型 ────────────────────────────────────────────────────────

/**
 * v6 搜索匹配。
 * 旧 `SearchMatch` 是其子集；为避免外部破坏，类型上等同于 SearchMatchV6。
 */
export type SearchMatch = SearchMatchV6;

export interface SearchOptions {
	maxResults?: number;
	minScore?: number;
	includeFailed?: boolean;
}

// ─── 内部解析类型 ────────────────────────────────────────────────────

interface ParsedWikiPage {
	match: SearchMatchV6;
	/** 全文（用于 legacy fallback + 全文打分） */
	fullText: string;
}

// ─── 字段权重 ────────────────────────────────────────────────────────

const FIELD_WEIGHTS: Record<string, number> = {
	title: 4,
	tags: 3,
	claim: 3,
	evidence: 2,
	interpretation: 1,
	useFor: 1,
	// legacy 全文兜底
	fullText: 0.5,
};

const MIN_KEYWORD_LENGTH = 1;

// ─── 主入口 ──────────────────────────────────────────────────────────

/**
 * 本地搜索 wiki 知识库
 *
 * 流程：
 *  1. 读取 wiki/ 下所有 .md 文件
 *  2. 解析 frontmatter + body sections
 *  3. 按关键词命中 * 字段权重 打分
 *  4. 按分数降序返回
 */
export function searchWiki(
	config: AppConfig,
	query: string,
	opts: SearchOptions = {},
): SearchMatchV6[] {
	const { maxResults = 20, minScore = 0.01, includeFailed = false } = opts;

	const pages = loadAllPages(config, includeFailed);
	if (pages.length === 0) return [];

	const keywords = extractKeywords(query);
	if (keywords.length === 0) return [];

	const scored: Array<{ page: ParsedWikiPage; score: number }> = [];

	for (const page of pages) {
		const score = computeScore(page, keywords);
		if (score >= minScore) {
			scored.push({ page, score });
		}
	}

	// 按分数降序
	scored.sort((a, b) => b.score - a.score);

	return scored.slice(0, maxResults).map((s) => ({
		...s.page.match,
		score: s.score,
	}));
}

// ─── 页面加载 ────────────────────────────────────────────────────────

function loadAllPages(
	config: AppConfig,
	includeFailed = false,
): ParsedWikiPage[] {
	const results: ParsedWikiPage[] = [];

	for (const dirName of WIKI_NODE_DIRS) {
		const dir = join(config.wikiDir, dirName);
		if (!existsSync(dir)) continue;
		const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
		for (const file of files) {
			const content = readFileSync(join(dir, file), "utf-8");
			const parsed = parseWikiPage(dirName, file, content);
			if (!parsed) continue;
			if (!includeFailed && parsed.match.auditStatus === "failed") continue;
			results.push(parsed);
		}
	}

	return results;
}

function parseWikiPage(
	dirName: string,
	fileName: string,
	content: string,
): ParsedWikiPage | null {
	if (!content || content.trim().length === 0) return null;

	const filePath = `wiki/${dirName}/${fileName}`;
	const parsed = parseWikiContent(content, filePath);
	const fm = parsed.frontmatter;

	const match: SearchMatchV6 = {
		nodeId: parsed.nodeId || fileName.replace(/\.md$/, ""),
		kind: parsed.kind as WikiKind,
		title: parsed.title,
		score: 0, // 由 searchWiki 计算
		filePath,
		claim: parsed.sections.claim,
		evidence: parsed.sections.evidence,
		interpretation: parsed.sections.interpretation,
		limits: parsed.sections.limits,
		useFor: parsed.sections.useFor,
		sourceIds: fm.sourceIds ?? [],
		sourceChase: fm.sourceChase ?? [],
		propRefs: fm.propRefs ?? [],
		related: fm.related ?? [],
		tags: fm.tags ?? [],
		auditStatus: fm.auditStatus as AuditStatus | undefined,
		auditScore: fm.auditScore,
	};

	return { match, fullText: content };
}

// ─── 关键词提取 ──────────────────────────────────────────────────────

/** Intl.Segmenter 实例（Node 22+ 内置，用于中文分词） */
const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });

/** 数学表达式和特殊 token 正则：匹配 1/e, e^{-1}, 36.8%, (1-1/n)^n 等 */
const MATH_TOKEN_RE = /[0-9]+[\/\\^][a-zA-Z0-9{}()\[\]+\-]+|[0-9]+\.?[0-9]*%/g;

function extractKeywords(query: string): string[] {
	const keywords: string[] = [];

	// ── Step 1: 提取数学表达式和特殊 token（保留整体，不分词） ──
	const mathTokens = query.match(MATH_TOKEN_RE) ?? [];
	const mathSet = new Set(mathTokens.map((t) => t.toLowerCase()));
	// 从 query 中移除已提取的数学 token，避免重复分词
	let stripped = query;
	for (const mt of mathTokens) {
		stripped = stripped.replace(mt, " ");
	}

	// ── Step 2: 使用 Intl.Segmenter 对剩余部分做分词 ──
	const segments = segmenter.segment(stripped);
	for (const { segment, isWordLike } of segments) {
		if (isWordLike && segment.trim().length > MIN_KEYWORD_LENGTH) {
			keywords.push(segment.toLowerCase());
		}
	}

	// ── Step 3: 合入数学 token ──
	for (const mt of mathSet) {
		keywords.push(mt);
	}

	// fallback: 如果分词结果为空（极端情况），用旧逻辑
	if (keywords.length === 0) {
		return query
			.toLowerCase()
			.split(/[\s,，。？、；：()（）\[\]【】"'`!?;:「」.]+/)
			.map((w) => w.trim())
			.filter((w) => w.length > MIN_KEYWORD_LENGTH);
	}
	return keywords;
}

// ─── 分数计算 ────────────────────────────────────────────────────────

function computeScore(page: ParsedWikiPage, keywords: string[]): number {
	let totalScore = 0;
	const m = page.match;

	for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
		const text = getFieldText(m, page.fullText, field);
		if (!text) continue;

		const lower = text.toLowerCase();
		let hits = 0;
		for (const kw of keywords) {
			if (lower.includes(kw)) {
				hits++;
			}
		}
		totalScore += (hits / keywords.length) * weight;
	}

	return totalScore;
}

/** 获取指定字段的文本内容（用于打分） */
function getFieldText(
	m: SearchMatchV6,
	fullText: string,
	field: string,
): string {
	switch (field) {
		case "title":
			return m.title;
		case "tags":
			return m.tags.join(" ");
		case "claim":
			return m.claim;
		case "evidence":
			return m.evidence.join("\n");
		case "interpretation":
			return m.interpretation;
		case "useFor":
			return m.useFor.join("\n");
		case "fullText":
			return fullText;
		default:
			return "";
	}
}

// ─── KeywordSearchProvider ─────────────────────────────────────────

/**
 * 关键词搜索提供者——v1 默认搜索后端。
 *
 * 使用 Intl.Segmenter 做中文分词，按字段权重打分。
 * 实现 SearchProvider 接口，可被 QmdSearchProvider 等替换。
 */
export class KeywordSearchProvider implements SearchProvider {
	search(
		config: AppConfig,
		query: string,
		options?: ProviderSearchOptions,
	): SearchResult {
		const matches = searchWiki(config, query, {
			maxResults: options?.maxResults,
			minScore: options?.minScore,
			includeFailed: options?.includeFailed,
		});
		return { matches };
	}
}
