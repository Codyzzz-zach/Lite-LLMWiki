/**
 * renderWikiNode — 将 WikiNodeDraft 渲染为固定格式 Markdown
 *
 * v6 输出结构:
 *   - frontmatter（稳定 YAML 序列化；v5 + v6 字段，空值/空数组跳过）
 *   - body sections:
 *       ## Claim
 *       ## Evidence          (空则输出 `*(no direct evidence)*` 占位)
 *       ## Interpretation
 *       ## Use For
 *       ## Limits
 *       ## Links
 *       ## Audit Notes       (v6 新增；spec 6.3)
 *       ## Board Use         (v6 新增；spec 6.3)
 *   - v6 默认值：auditStatus 缺失时给 "pending"（plan 6.7）
 *   - 不再自动推断 status（B1：v6 节点应显式声明）
 */
import type {
  Evidence,
  ValidatedWikiFrontmatter,
  WikiFrontmatter,
  WikiNodeDraft,
} from "../types.js";

export function renderWikiNode(draft: WikiNodeDraft): string {
  const { claim, evidence, interpretation, useFor, limits, links, auditNotes, boardUse } = draft;

  const normalizedFrontmatter = normalizeFrontmatter(draft);
  const fmLines = serializeFrontmatter(normalizedFrontmatter);
  const bodyParts: string[] = [];

  // ── Claim ──
  bodyParts.push("## Claim\n");
  bodyParts.push(claim);

  // ── Evidence ──
  bodyParts.push("\n## Evidence\n");
  if (!evidence || evidence.length === 0) {
    bodyParts.push("*(no direct evidence)*");
  } else {
    for (const ev of evidence) {
      const refs =
        ev.chunkRefs.length > 0 ? ` | Chunks: [${ev.chunkRefs.join(", ")}]` : "";
      bodyParts.push(`- **Source**: ${ev.sourceId}${refs}`);
      if (ev.summary) {
        bodyParts.push(`  - Summary: ${ev.summary}`);
      }
      const quote = ev.excerpt ?? ev.quote;
      if (quote) {
        bodyParts.push(`  > ${quote}`);
      }
    }
  }

  // ── Interpretation ──
  if (interpretation) {
    bodyParts.push("\n## Interpretation\n");
    bodyParts.push(interpretation);
  }

  // ── Use For ──
  if (useFor && useFor.length > 0) {
    bodyParts.push("\n## Use For\n");
    for (const item of useFor) {
      bodyParts.push(`- ${item}`);
    }
  }

  // ── Limits ──
  if (limits && limits.length > 0) {
    bodyParts.push("\n## Limits\n");
    for (const item of limits) {
      bodyParts.push(`- ${item}`);
    }
  }

  // ── Links ──
  if (links && links.length > 0) {
    bodyParts.push("\n## Links\n");
    for (const item of links) {
      bodyParts.push(`- ${item}`);
    }
  }

  // ── Audit Notes (v6) ──
  if (auditNotes && auditNotes.trim().length > 0) {
    bodyParts.push("\n## Audit Notes\n");
    bodyParts.push(auditNotes.trim());
  }

  // ── Board Use (v6) ──
  if (boardUse && boardUse.length > 0) {
    bodyParts.push("\n## Board Use\n");
    for (const item of boardUse) {
      bodyParts.push(`- ${item}`);
    }
  }

  const body = bodyParts.join("\n") + "\n";
  return `---\n${fmLines.join("\n")}\n---\n\n${body}`;
}

// ─── 稳定 YAML 序列化 ───────────────────────────────────────────

/**
 * 归一化 frontmatter：
 * - v5 必填字段从 draft 推导出合理默认值（sourceIds、sourceChase、chunkRefs、tags、related、createdAt、updatedAt）
 * - v6 字段透传（如有）
 * - B1: status 不再自动推断；v6 节点应显式声明
 * - 保留 v5 兼容：caller 已显式给的 status 不会被覆盖
 */
export function normalizeFrontmatter(draft: WikiNodeDraft): ValidatedWikiFrontmatter {
  const evidence = draft.evidence ?? [];
  const sourceIds = unique([
    ...(draft.frontmatter.sourceIds ?? []),
    ...(draft.frontmatter.source ? [draft.frontmatter.source] : []),
    ...evidence.map((ev) => ev.sourceId),
  ]);
  const chunkRefs = uniqueNumbers([
    ...(draft.frontmatter.chunkRefs ?? []),
    ...evidence.flatMap((ev) => ev.chunkRefs),
  ]);
  const sourceChase = unique(draft.frontmatter.sourceChase ?? []);
  const now = new Date().toISOString();

  const normalized: ValidatedWikiFrontmatter = {
    ...draft.frontmatter,
    nodeId: draft.frontmatter.nodeId ?? draft.nodeId,
    kind: draft.frontmatter.kind ?? draft.kind,
    title: draft.frontmatter.title,
    sourceIds,
    sourceChase,
    chunkRefs,
    // v5 兼容：confidence 缺失时给个保守默认
    confidence: draft.frontmatter.confidence ?? (evidence.length > 0 ? 0.7 : 0.3),
    // v5 兼容：status 缺失时给 needs_review（B1：不再自动推断为 verified）
    status: draft.frontmatter.status ?? "needs_review",
    // v6：auditStatus 必填（plan 6.7 + X1），缺省给 "pending"
    auditStatus: draft.frontmatter.auditStatus ?? "pending",
    tags: draft.frontmatter.tags ?? [],
    related: draft.frontmatter.related ?? [],
    createdAt: draft.frontmatter.createdAt ?? now,
    updatedAt: draft.frontmatter.updatedAt ?? draft.frontmatter.createdAt ?? now,
  };

  validateFrontmatter(normalized, draft);
  return normalized;
}

function validateFrontmatter(fm: ValidatedWikiFrontmatter, draft: WikiNodeDraft): void {
  const errors: string[] = [];
  if (!fm.nodeId) errors.push("nodeId is required");
  if (!fm.kind) errors.push("kind is required");
  if (!fm.title) errors.push("title is required");
  if (fm.sourceIds.length === 0) errors.push("sourceIds must not be empty");
  if (fm.sourceChase.length === 0) errors.push("sourceChase must not be empty");
  if (fm.chunkRefs.length === 0) errors.push("chunkRefs must not be empty");
  if (!draft.claim || draft.claim.trim().length === 0) errors.push("claim must not be empty");
  if (errors.length > 0) {
    throw new Error(`Invalid WikiNodeDraft "${draft.nodeId}": ${errors.join("; ")}`);
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value)))].sort((a, b) => a - b);
}

/** 跳过 evidence（进入 body section）和空值 */
const SKIP_KEYS = new Set(["evidence"]);

function serializeFrontmatter(fm: WikiFrontmatter): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fm)) {
    if (value === undefined || value === null) continue;
    if (SKIP_KEYS.has(key)) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${formatScalar(item)}`);
      }
    } else if (typeof value === "object") {
      // Evidence 对象已跳过，其他复杂对象暂不处理
      continue;
    } else {
      lines.push(`${key}: ${formatScalar(value)}`);
    }
  }
  return lines;
}

function formatScalar(val: unknown): string {
  if (typeof val === "string") {
    // YAML safe-quote: if contains special chars, wrap in double quotes
    if (/[:#\[\]{}",\n]/.test(val) || val.startsWith("- ") || val.startsWith("'") || val.startsWith('"')) {
      return `"${val.replace(/"/g, '\\"')}"`;
    }
    return val;
  }
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "true" : "false";
  return String(val);
}
