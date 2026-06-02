/**
 * search — 本地结构化检索，不依赖 LLM
 *
 * 从 wiki/ 读取 v5 / v4 页面，解析 frontmatter 和 body sections，
 * 按字段权重打分返回匹配节点。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../types.js";

// ─── 公开类型 ────────────────────────────────────────────────────────

export interface SearchMatch {
  nodeId: string;
  kind: string;
  title: string;
  score: number;
  filePath: string;
  claim: string;
  /** evidence 摘要列表 */
  evidence: string[];
}

export interface SearchOptions {
  /** 最多返回多少条，默认 20 */
  maxResults?: number;
  /** 最低分数阈值，默认 0.01（只返回有匹配的结果） */
  minScore?: number;
}

// ─── 内部解析类型 ────────────────────────────────────────────────────

interface ParsedWikiPage {
  nodeId: string;
  kind: string;
  title: string;
  filePath: string;
  tags: string[];
  claim: string;
  evidence: string[];
  interpretation: string;
  useFor: string[];
  /** 全文（用于 legacy fallback） */
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
 *  1. 读取 wiki/concepts/ 下所有 .md 文件
 *  2. 解析 frontmatter + body sections
 *  3. 按关键词命中 * 字段权重 打分
 *  4. 按分数降序返回
 */
export function searchWiki(
  config: AppConfig,
  query: string,
  opts: SearchOptions = {},
): SearchMatch[] {
  const { maxResults = 20, minScore = 0.01 } = opts;

  const pages = loadAllPages(config);
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
    nodeId: s.page.nodeId,
    kind: s.page.kind,
    title: s.page.title,
    score: s.score,
    filePath: s.page.filePath,
    claim: s.page.claim,
    evidence: s.page.evidence,
  }));
}

// ─── 页面加载 ────────────────────────────────────────────────────────

function loadAllPages(config: AppConfig): ParsedWikiPage[] {
  const dir = join(config.wikiDir, "concepts");
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  const results: ParsedWikiPage[] = [];

  for (const file of files) {
    const content = readFileSync(join(dir, file), "utf-8");
    const parsed = parseWikiPage(file, content);
    if (parsed) results.push(parsed);
  }

  return results;
}

// ─── 页面解析 ────────────────────────────────────────────────────────

function parseWikiPage(fileName: string, content: string): ParsedWikiPage | null {
  if (!content || content.trim().length === 0) return null;

  const filePath = `wiki/concepts/${fileName}`;

  // ── 解析 frontmatter ──
  const fm = parseFrontmatter(content);

  const nodeId = fm.nodeId || fileName.replace(/\.md$/, "");
  const kind = fm.kind || "concept";
  const title = fm.title || nodeId;
  const tags: string[] = parseTags(fm.tags);

  // ── 解析 body section ──
  const body = extractBody(content);
  const sections = parseBodySections(body);

  const claim = sections.claim || "";
  const evidence = sections.evidence;
  const interpretation = sections.interpretation || "";
  const useFor = sections.useFor;
  const fullText = content;

  return {
    nodeId,
    kind,
    title,
    filePath,
    tags,
    claim,
    evidence,
    interpretation,
    useFor,
    fullText,
  };
}

/** 解析 frontmatter（`---\n...\n---` 中的 key: value 行） */
function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return result;

  for (const line of match[1]!.split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    // 只取简单标量值（跳过数组行如 `  - item`）
    const val = line.slice(colon + 1).trim();
    if (val && !val.startsWith("- ")) {
      // 去掉可能的引号
      result[key] = val.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  }
  return result;
}

/** 从 `tags:` 多行值中提取标签数组 */
function parseTags(tagVal: string | undefined): string[] {
  if (!tagVal) return [];
  // 逗号分隔
  if (tagVal.includes(",")) {
    return tagVal.split(/,\s*/).filter(Boolean);
  }
  // 单一标签
  return [tagVal].filter(Boolean);
}

/** 提取 body（去掉 frontmatter 后的内容） */
function extractBody(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n\n?([\s\S]*)$/);
  return match ? match[1]!.trim() : content.trim();
}

/** 从 body 中提取命名 section 的内容 */
function parseBodySections(body: string): {
  claim: string;
  evidence: string[];
  interpretation: string;
  useFor: string[];
} {
  const sections: Record<string, string[]> = {};
  // 匹配 `## SectionName`，后面跟到下一个 `## ` 或文件尾
  const sectionRegex = /^##\s+(.+?)\s*$\n?([\s\S]*?)(?=^##\s|\n*$)/gm;
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(body)) !== null) {
    const name = match[1]!.trim().toLowerCase();
    const content = match[2]!.trim();
    sections[name] = sections[name] || [];
    sections[name].push(content);
  }

  // 提取 evidence 摘要：每行 `- ...` 或 `> ...`
  const evidenceText = sections["evidence"] || [];
  const evidence: string[] = [];
  for (const block of evidenceText) {
    // 提取 bullet 行和 blockquote 行
    const lines = block.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      // 匹配 `- **Source**: ...` 或 `  > excerpt` 或 `- item`
      if (trimmed.startsWith("- ") || trimmed.startsWith("> ")) {
        const cleaned = trimmed.replace(/^[->\s]+/, "").trim();
        if (cleaned && cleaned.length > 3) {
          evidence.push(cleaned);
        }
      }
    }
  }

  const claim = (sections["claim"] || []).join("\n");
  const interpretation = (sections["interpretation"] || []).join("\n");

  // Use For: 提取 bullet 项
  const useForBlocks = sections["use for"] || [];
  const useFor: string[] = [];
  for (const block of useForBlocks) {
    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("- ")) {
        useFor.push(trimmed.slice(2).trim());
      }
    }
  }

  return { claim, evidence, interpretation, useFor };
}

// ─── 关键词提取 ──────────────────────────────────────────────────────

function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,，。？、；：()（）\[\]【】"'"「」]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > MIN_KEYWORD_LENGTH);
}

// ─── 分数计算 ────────────────────────────────────────────────────────

function computeScore(page: ParsedWikiPage, keywords: string[]): number {
  let totalScore = 0;

  // 对每个字段计算关键词匹配数 * 权重
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    const text = getFieldText(page, field);
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
function getFieldText(page: ParsedWikiPage, field: string): string {
  switch (field) {
    case "title":
      return page.title;
    case "tags":
      return page.tags.join(" ");
    case "claim":
      return page.claim;
    case "evidence":
      return page.evidence.join("\n");
    case "interpretation":
      return page.interpretation;
    case "useFor":
      return page.useFor.join("\n");
    case "fullText":
      return page.fullText;
    default:
      return "";
  }
}
