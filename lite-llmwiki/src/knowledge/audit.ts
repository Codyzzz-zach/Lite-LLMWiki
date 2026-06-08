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
 *
 * 所有 wiki 解析统一走 `wiki-parser.ts`；chase marker 解析走 `chase.ts`（兼容 v5 + v6 格式）。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../types.js";
import { collectChunkIndices } from "./chase.js";
import {
  WIKI_NODE_DIRS,
  extractRawId,
  parseWikiContent,
  updateFrontmatter,
} from "./wiki-parser.js";

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
    const content = readFileSyncSafe(fullPath);
    if (content === null) {
      issues.push({
        severity: "error",
        filePath,
        message: "Cannot read wiki file",
      });
      nodes++;
      continue;
    }
    const parsed = parseWikiContent(content, fullPath);

    // ── Legacy v4 页面（仅依赖 nodeId 缺失；v5 节点都有 nodeId） ──
    if (parsed.isLegacy) {
      issues.push({
        severity: "warning",
        filePath,
        message: "Legacy page (missing nodeId) — needs migration",
      });
      nodes++;
      continue;
    }

    // ── 根据 source 过滤 ──
    if (options?.source) {
      const sourceFilter = options.source.replace(/[\/:]/g, "_");
      const sourceChaseVals = parsed.frontmatter.sourceChase ?? [];
      const sourceChaseRaw = sourceChaseVals[0] ?? "";
      const rawId = sourceChaseRaw ? extractRawId(sourceChaseRaw) : "";
      if (!rawId.includes(sourceFilter) && sourceChaseRaw !== sourceFilter) {
        continue; // 不匹配过滤条件，跳过
      }
    }

    nodes++;

    // ── Check: sourceChase ──
    const sourceChaseVals = parsed.frontmatter.sourceChase ?? [];
    let chaseFileContent: string | null = null;
    let chaseExists = false;

    if (sourceChaseVals.length > 0) {
      const sourceChaseVal = sourceChaseVals[0]!;
      const rawId = extractRawId(sourceChaseVal);
      // 尝试多种路径
      const candidates = [join(chaseDir, `${rawId}.md`)];
      if (!sourceChaseVal.includes("/")) {
        candidates.push(join(chaseDir, sourceChaseVal));
      }
      for (const c of candidates) {
        if (existsSync(c)) {
          chaseFileContent = readFileSyncSafe(c);
          if (chaseFileContent !== null) {
            chaseExists = true;
            break;
          }
        }
      }
    }

    if (!chaseExists) {
      issues.push({
        severity: "error",
        filePath,
        nodeId: parsed.nodeId,
        message: `sourceChase file not found: ${sourceChaseVals[0] || "(empty)"}`,
      });
    }

    // ── Check: chunkRefs ──
    const chunkRefs = parsed.frontmatter.chunkRefs ?? [];
    if (chunkRefs.length === 0) {
      invalidChunkRefs++;
      issues.push({
        severity: "error",
        filePath,
        nodeId: parsed.nodeId,
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
            nodeId: parsed.nodeId,
            message: `Invalid chunkRef: ${ref} — not found in chase file`,
          });
        }
      }
    }

    // ── Check: evidence ──
    if (parsed.sections.evidence.length === 0) {
      missingEvidence++;
      issues.push({
        severity: "error",
        filePath,
        nodeId: parsed.nodeId,
        message: "Missing or empty Evidence section",
      });
    }

    // ── Check: claim ──
    if (!parsed.sections.claim) {
      issues.push({
        severity: "error",
        filePath,
        nodeId: parsed.nodeId,
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

// ─── 工具 ─────────────────────────────────────────────────────────────

/** 安全读文件，IO 错误时返回 null（不抛） */
function readFileSyncSafe(p: string): string | null {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

// ─── Audit 结果写回 ────────────────────────────────────────────────

/** 将结构 audit 结果写回 wiki 节点 frontmatter（auditStatus 字段） */
export function writeAuditResults(config: AppConfig, result: AuditResult): void {
  const errorFiles = new Set<string>();
  const passedFiles = new Set<string>();

  for (const issue of result.issues) {
    if (issue.severity === "error" && issue.filePath) {
      errorFiles.add(issue.filePath);
    }
  }

  for (const { filePath, fullPath } of filesFromConfig(config)) {
    if (errorFiles.has(filePath)) {
      updateFrontmatter(fullPath, { auditStatus: "failed" });
    } else {
      passedFiles.add(filePath);
      updateFrontmatter(fullPath, { auditStatus: "passed" });
    }
  }
}

function filesFromConfig(config: AppConfig): { filePath: string; fullPath: string }[] {
  return WIKI_NODE_DIRS.flatMap((dirName) => {
    const dir = join(config.wikiDir, dirName);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({ filePath: `wiki/${dirName}/${f}`, fullPath: join(dir, f) }));
  });
}
