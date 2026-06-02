/**
 * renderWikiNode — 将 WikiNodeDraft 渲染为固定格式 Markdown
 *
 * 输出结构:
 *   - frontmatter（稳定 YAML 序列化，空值/空数组跳过）
 *   - body 固定 sections: Claim / Evidence / Interpretation / Use For / Limits / Links
 *   - 空 section 不输出; Evidence 为空则输出 `*(no direct evidence)*` 占位
 */
import type { Evidence, ValidatedWikiFrontmatter, WikiFrontmatter, WikiNodeDraft } from "../types.js";

export function renderWikiNode(draft: WikiNodeDraft): string {
  const { frontmatter, claim, evidence, interpretation, useFor, limits, links } = draft;

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

  const body = bodyParts.join("\n") + "\n";
  return `---\n${fmLines.join("\n")}\n---\n\n${body}`;
}

// ─── 稳定 YAML 序列化 ───────────────────────────────────────────

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
  const confidence = draft.frontmatter.confidence ?? (evidence.length > 0 ? 0.7 : 0.3);
  const status = draft.frontmatter.status
    ?? (evidence.length > 0 && sourceChase.length > 0 && chunkRefs.length > 0 ? "verified" : "needs_review");

  const normalized: ValidatedWikiFrontmatter = {
    ...draft.frontmatter,
    nodeId: draft.frontmatter.nodeId ?? draft.nodeId,
    kind: draft.frontmatter.kind ?? draft.kind,
    title: draft.frontmatter.title,
    sourceIds,
    sourceChase,
    chunkRefs,
    confidence,
    status,
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
  if (draft.evidence.length === 0 && fm.status === "verified") {
    errors.push("verified nodes require evidence");
  }
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
