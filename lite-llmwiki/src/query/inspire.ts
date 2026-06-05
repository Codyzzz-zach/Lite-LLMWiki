/**
 * inspire — 随机从 wiki 中抽取一条概念页，提供灵感
 *
 * 不依赖 LLM，纯本地文件随机选取。
 *
 * v6 后续将升级为 board-driven（spec Phase 4），当前保持 v5 行为。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../types.js";
import { WIKI_NODE_DIRS, parseWikiContent } from "../knowledge/wiki-parser.js";

// ─── 公开类型 ────────────────────────────────────────────────────────

export interface InspireResult {
  nodeId: string;
  kind: string;
  title: string;
  filePath: string;
  /** tags 列表（已归一化：逗号字符串被拆分） */
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
  const files = WIKI_NODE_DIRS.flatMap((dirName) => {
    const dir = join(config.wikiDir, dirName);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const fp = join(dir, f);
        const stat = statSync(fp, { throwIfNoEntry: false });
        return {
          content: readFileSync(fp, "utf-8"),
          filePath: `wiki/${dirName}/${f}`,
          mtimeMs: stat?.mtimeMs ?? 0,
        };
      });
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

  const parsed = parseWikiContent(content, raw.filePath);

  return {
    nodeId: parsed.nodeId || raw.filePath.replace(/^wiki\/concepts\//, "").replace(/\.md$/, ""),
    kind: parsed.kind,
    title: parsed.title,
    filePath: raw.filePath,
    tags: parsed.frontmatter.tags ?? [],
    claim: parsed.sections.claim,
    evidence: parsed.sections.evidence,
    interpretation: parsed.sections.interpretation,
    useFor: parsed.sections.useFor,
    mtimeMs: raw.mtimeMs,
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
