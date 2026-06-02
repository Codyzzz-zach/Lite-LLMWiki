/**
 * renderWikiNode — 将 WikiNodeDraft 渲染为固定格式 Markdown
 *
 * 输出结构:
 *   - frontmatter（稳定 YAML 序列化，空值/空数组跳过）
 *   - body 固定 sections: Claim / Evidence / Interpretation / Use For / Limits / Links
 *   - 空 section 不输出; Evidence 为空则输出 `*(no direct evidence)*` 占位
 */
import type { Evidence, WikiFrontmatter, WikiNodeDraft } from "../types.js";

export function renderWikiNode(draft: WikiNodeDraft): string {
  const { frontmatter, claim, evidence, interpretation, useFor, limits, links } = draft;

  const fmLines = serializeFrontmatter(frontmatter);
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
      if (ev.excerpt) {
        bodyParts.push(`  > ${ev.excerpt}`);
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
