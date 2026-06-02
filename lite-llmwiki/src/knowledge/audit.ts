/**
 * auditWiki — 检查 wiki 是否能追溯到 raw/chase
 *
 * 检查项:
 *   - v5 schema: nodeId / kind / sourceChase / chunkRefs
 *   - sourceChase 文件是否存在
 *   - chunkRefs 是否有效（能在 chase 中找到对应标记）
 *   - evidence 是否非空
 *   - claim 是否存在
 *   - legacy 页面标记为 needs_migration
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AppConfig } from "../types.js";

const WIKI_NODE_DIRS = ["concepts", "methods", "cases", "equations", "questions", "insights", "anchors", "counters"];

// ─── 公开类型 ─────────────────────────────────────────────────────────

export type AuditSeverity = "error" | "warning" | "info";

export interface AuditIssue {
  severity: AuditSeverity;
  filePath: string;
  message: string;
  nodeId?: string;
}

export interface AuditSummary {
  nodes: number;
  verifiedNodes: number;
  missingEvidence: number;
  invalidChunkRefs: number;
  coverage: number;
}

export interface AuditResult {
  ok: boolean;
  summary: AuditSummary;
  issues: AuditIssue[];
}

// ─── 内部解析 ─────────────────────────────────────────────────────────

/** 解析 frontmatter key-value（仅简单单行值，不处理 YAML 嵌套） */
function parseFrontmatter(content: string): Record<string, string | string[]> {
  const fm: Record<string, string | string[]> = {};
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return fm;
  let currentArrayKey: string | null = null;
  for (const line of match[1]!.split("\n")) {
    const arrayItem = line.match(/^\s*-\s+(.+)$/);
    if (arrayItem && currentArrayKey) {
      const current = fm[currentArrayKey];
      fm[currentArrayKey] = [...(Array.isArray(current) ? current : []), arrayItem[1]!.trim()];
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (!key) continue;
    if (val) {
      fm[key] = val;
      currentArrayKey = null;
    } else {
      fm[key] = [];
      currentArrayKey = key;
    }
  }
  return fm;
}

/** 解析 body 中 ## 开头的 section（取第一层） */
function parseBodySections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const // 找到 frontmatter 结束
    bodyStart = content.search(/\n---\n/);
  if (bodyStart === -1) return sections;
  const body = content.slice(bodyStart + 5); // 跳过 "\n---\n"

  const re = /^##\s+(.+?)\s*$/gm;
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;

  while ((match = re.exec(body)) !== null) {
    if (last) {
      const name = last[1]!.trim();
      const text = body.slice(last.index + last[0].length, match.index).trim();
      sections[name] = text;
    }
    last = match;
  }
  if (last) {
    const name = last[1]!.trim();
    const text = body.slice(last.index + last[0].length).trim();
    sections[name] = text;
  }
  return sections;
}

/** 从 chase 文件中收集所有 chunk 索引 */
function collectChunkIndices(chaseContent: string): Set<number> {
  const indices = new Set<number>();
  const re = /<!--\s*chunk:(\d+)(?:\s+[^>]*)?\s*-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chaseContent)) !== null) {
    indices.add(parseInt(m[1]!, 10));
  }
  return indices;
}

/** 解析 chunkRefs 字符串（如 "[1, 2]" 或 "1, 2"）为数字数组 */
function parseStringList(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return raw
    .replace(/[\[\]]/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseChunkRefs(raw: string | string[] | undefined): number[] {
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw : raw.replace(/[\[\]]/g, "").split(",");
  return values
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}

/** 从 sourceChase 值提取原始 source id（去掉 .md 扩展名和 raw/chase/ 前缀） */
function extractRawId(chaseVal: string): string {
  return basename(chaseVal, ".md");
}

// ─── 主函数 ───────────────────────────────────────────────────────────

export function auditWiki(
  config: AppConfig,
  options?: { source?: string },
): AuditResult {
  const issues: AuditIssue[] = [];
  const chaseDir = join(config.rawDir, "chase");

  const files = WIKI_NODE_DIRS.flatMap((dirName) => {
    const dir = join(config.wikiDir, dirName);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((file) => file.endsWith(".md"))
      .map((file) => ({ file, dirName, fullPath: join(dir, file), filePath: `wiki/${dirName}/${file}` }));
  });

  if (files.length === 0) {
    return {
      ok: true,
      summary: {
        nodes: 0,
        verifiedNodes: 0,
        missingEvidence: 0,
        invalidChunkRefs: 0,
        coverage: 1,
      },
      issues: [],
    };
  }

  let nodes = 0;
  let verifiedNodes = 0;
  let missingEvidence = 0;
  let invalidChunkRefs = 0;

  for (const { filePath, fullPath } of files) {
    const content = readFileSync(fullPath, "utf-8");
    const fm = parseFrontmatter(content);
    const body = parseBodySections(content);

    const nodeId = scalar(fm["nodeId"]);
    const kind = scalar(fm["kind"]);

    // ── Legacy v4 页面 ──
    if (!nodeId || !kind) {
      issues.push({
        severity: "warning",
        filePath,
        message: "Legacy page (missing nodeId/kind) — needs migration",
      });
      nodes++;
      continue;
    }

    // ── 根据 source 过滤 ──
    if (options?.source) {
      const sourceFilter = options.source.replace(/[\/:]/g, "_");
      const sourceChaseRaw = parseStringList(fm["sourceChase"])[0] ?? "";
      // sourceChase 可能是 "raw/chase/xxx.md" 或空
      const rawId = extractRawId(sourceChaseRaw);
      if (!rawId.includes(sourceFilter) && sourceChaseRaw !== sourceFilter) {
        continue; // 不匹配过滤条件，跳过
      }
    }

    nodes++;

    // ── Check: sourceChase ──
    const sourceChaseVals = parseStringList(fm["sourceChase"]);
    let chaseFileContent: string | null = null;
    let chaseExists = false;

    if (sourceChaseVals.length > 0) {
      const sourceChaseVal = sourceChaseVals[0]!;
      const rawId = extractRawId(sourceChaseVal);
      // 尝试多种路径
      const candidates = [join(chaseDir, `${rawId}.md`)];
      if (!sourceChaseVal.includes("/")) {
        // 也尝试带 raw/chase/ 前缀
        candidates.push(join(chaseDir, sourceChaseVal));
      }
      for (const c of candidates) {
        const resolved = c;
        if (existsSync(resolved)) {
          chaseFileContent = readFileSync(resolved, "utf-8");
          chaseExists = true;
          break;
        }
      }
    }

    if (!chaseExists) {
      issues.push({
        severity: "error",
        filePath,
        nodeId,
        message: `sourceChase file not found: ${sourceChaseVals[0] || "(empty)"}`,
      });
    }

    // ── Check: chunkRefs ──
    const chunkRefs = parseChunkRefs(fm["chunkRefs"]);
    if (chunkRefs.length === 0) {
      invalidChunkRefs++;
      issues.push({
        severity: "error",
        filePath,
        nodeId,
        message: "Missing chunkRefs",
      });
    }

    if (chunkRefs.length > 0 && chaseFileContent) {
      const validIndices = collectChunkIndices(chaseFileContent);
      for (const ref of chunkRefs) {
        if (!validIndices.has(ref)) {
          invalidChunkRefs++;
          issues.push({
            severity: "error",
            filePath,
            nodeId,
            message: `Invalid chunkRef: ${ref} — not found in chase file`,
          });
        }
      }
    }

    // ── Check: evidence ──
    const evidenceSection = body["Evidence"];
    if (!evidenceSection || /^\s*$/.test(evidenceSection)) {
      missingEvidence++;
      issues.push({
        severity: "error",
        filePath,
        nodeId,
        message: "Missing or empty Evidence section",
      });
    }

    // ── Check: claim ──
    const claimSection = body["Claim"];
    if (!claimSection || /^\s*$/.test(claimSection)) {
      issues.push({
        severity: "error",
        filePath,
        nodeId,
        message: "Missing or empty Claim section",
      });
    }

    const nodeHasError = issues.some((issue) => issue.severity === "error" && issue.filePath === filePath);
    if (!nodeHasError) verifiedNodes++;
  }

  const coverage = nodes > 0 ? verifiedNodes / nodes : 1;
  const ok = issues.every((issue) => issue.severity !== "error");

  return {
    ok,
    summary: {
      nodes,
      verifiedNodes,
      missingEvidence,
      invalidChunkRefs,
      coverage: Math.round(coverage * 100) / 100,
    },
    issues,
  };
}

function scalar(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
