/**
 * inspire — 随机从 wiki 中抽取一条概念页，提供灵感
 *
 * 不依赖 LLM，纯本地文件随机选取。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../types.js";

// ─── 公开类型 ────────────────────────────────────────────────────────

export interface InspireResult {
  nodeId: string;
  kind: string;
  title: string;
  filePath: string;
  /** tags 列表 */
  tags: string[];
  /** claim 全文（如果有） */
  claim: string;
  /** evidence 摘要列表 */
  evidence: string[];
  /** interpretation 全文（如果有） */
  interpretation: string;
  /** useFor 列表 */
  useFor: string[];
  /** 文件修改时间（用于排序/展示） */
  mtimeMs: number;
}

export interface InspireOptions {
  /** 按 kind 过滤（如 "concept"、"claim"、"insight"） */
  kind?: string;
  /** 按标签过滤（只要包含任一即匹配） */
  tags?: string[];
  /** 随机种子偏移（用于测试可复现），默认 Math.random */
  seed?: number;
}

// ─── 主入口 ──────────────────────────────────────────────────────────

/**
 * 从 wiki 知识库中随机抽取一条概念页
 *
 * 流程：
 *  1. 读取 wiki/concepts/ 下所有 .md 文件
 *  2. 按 opts 过滤（kind / tags）
 *  3. 随机选一条
 *  4. 解析返回结构化内容
 *
 * 返回 null 表示知识库为空或没有匹配项。
 */
export function inspireWiki(
  config: AppConfig,
  opts: InspireOptions = {},
): InspireResult | null {
  const pages = loadAllPages(config, opts);
  if (pages.length === 0) return null;

  // 随机选取
  const idx = pickRandom(pages.length, opts.seed);

  return pages[idx]!;
}

/**
 * 列出所有页面（不随机，按 mtime 倒序），
 * 用于 preview 或 "今日推荐" 场景
 */
export function listAllPages(
  config: AppConfig,
  opts: InspireOptions = {},
): InspireResult[] {
  return loadAllPages(config, opts);
}

// ─── 内部实现 ────────────────────────────────────────────────────────

interface RawPage {
  content: string;
  filePath: string;
  mtimeMs: number;
}

function loadAllPages(config: AppConfig, opts: InspireOptions = {}): InspireResult[] {
  const dir = join(config.wikiDir, "concepts");
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const fp = join(dir, f);
      const stat = statSync(fp, { throwIfNoEntry: false });
      return {
        content: readFileSync(fp, "utf-8"),
        filePath: `wiki/concepts/${f}`,
        mtimeMs: stat?.mtimeMs ?? 0,
      };
    });

  const results: InspireResult[] = [];

  for (const raw of files) {
    const parsed = parse(raw);
    if (!parsed) continue;

    // 按 kind 过滤
    if (opts.kind && parsed.kind !== opts.kind) continue;

    // 按 tags 过滤（任一匹配）
    if (opts.tags && opts.tags.length > 0) {
      const hasTag = opts.tags.some((t) =>
        parsed.tags.some((pt) => pt.toLowerCase().includes(t.toLowerCase())),
      );
      if (!hasTag) continue;
    }

    results.push(parsed);
  }

  return results;
}

function parse(raw: RawPage): InspireResult | null {
  const content = raw.content;
  if (!content || content.trim().length === 0) return null;

  const fm = parseFrontmatter(content);
  const nodeId = fm.nodeId || raw.filePath.replace(/^wiki\/concepts\//, "").replace(/\.md$/, "");
  const kind = fm.kind || "concept";
  const title = fm.title || nodeId;
  const tags = parseTags(fm.tags);

  const body = extractBody(content);
  const sections = parseBodySections(body);

  return {
    nodeId,
    kind,
    title,
    filePath: raw.filePath,
    tags,
    claim: sections.claim,
    evidence: sections.evidence,
    interpretation: sections.interpretation,
    useFor: sections.useFor,
    mtimeMs: raw.mtimeMs,
  };
}

/** 解析 frontmatter */
function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return result;

  for (const line of match[1]!.split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (val && !val.startsWith("- ")) {
      result[key] = val.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  }
  return result;
}

/** 提取 tags 数组 */
function parseTags(tagVal: string | undefined): string[] {
  if (!tagVal) return [];
  if (tagVal.includes(",")) {
    return tagVal.split(/,\s*/).filter(Boolean);
  }
  return [tagVal].filter(Boolean);
}

/** 提取 body（去掉 frontmatter） */
function extractBody(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n\n?([\s\S]*)$/);
  return match ? match[1]!.trim() : content.trim();
}

/** 从 body 中提取命名 section */
function parseBodySections(body: string): {
  claim: string;
  evidence: string[];
  interpretation: string;
  useFor: string[];
} {
  const sections: Record<string, string[]> = {};
  const sectionRegex = /^##\s+(.+?)\s*$\n?([\s\S]*?)(?=^##\s|\n*$)/gm;
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(body)) !== null) {
    const name = match[1]!.trim().toLowerCase();
    const content = match[2]!.trim();
    sections[name] = sections[name] || [];
    sections[name].push(content);
  }

  // 从 evidence section 提取 bullet / blockquote
  const evidenceText = sections["evidence"] || [];
  const evidence: string[] = [];
  for (const block of evidenceText) {
    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("- ") || trimmed.startsWith("> ")) {
        const cleaned = trimmed.replace(/^[->\s]+/, "").trim();
        if (cleaned && cleaned.length > 3) {
          evidence.push(cleaned);
        }
      }
    }
  }

  const claim = (sections["claim"] || []).join("\n");

  // 如果没有结构化 section，fallback 到 body 前 500 字符
  const fallbackClaim = !claim
    ? body.replace(/^#\s+.*$/m, "").trim().slice(0, 500)
    : "";

  const interpretation = (sections["interpretation"] || []).join("\n");

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

  return {
    claim: claim || fallbackClaim,
    evidence,
    interpretation,
    useFor,
  };
}

/** 随机选一个索引 */
function pickRandom(length: number, seed?: number): number {
  if (seed !== undefined) {
    // 简单确定性：用 seed 做 day 级别的偏移
    const dayOffset = Math.floor(Date.now() / 86400000);
    return Math.abs((seed * 9301 + dayOffset * 49297) % length);
  }
  return Math.floor(Math.random() * length);
}
