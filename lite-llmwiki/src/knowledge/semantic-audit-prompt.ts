/**
 * semantic-audit-prompt — semantic audit 的 prompt 构造 + LLM 响应解析
 *
 * 职责（plan 7.4 + 12.2）：
 * - 从 ParsedWikiNode + chase excerpts 构造审查输入
 * - 把输入渲染成 LLM prompt（含 5 个审查维度说明）
 * - 解析 LLM JSON 响应（含 ```json 包装 + 严格字段校验）
 *
 * 错误策略（spec 7.7）：JSON 解析失败 / 字段非法 → 抛错（由 semantic-audit 捕获
 * 并把该 node 记 warning + 存 raw response 摘要）。
 */
import type {
  ParsedWikiNode,
  SemanticJudgeVerdict,
  SemanticVerdict,
  WikiFrontmatter,
} from "../types.js";

// ─── 输入 ──────────────────────────────────────────────────────────

export interface SemanticAuditInput {
  nodeId: string;
  filePath: string;
  title: string;
  kind: string;
  frontmatter: WikiFrontmatter;
  claim: string;
  evidence: string[];
  interpretation: string;
  limits: string[];
  sourceChase: string[];
  chunkRefs: number[];
  chaseExcerpts: { index: number; text: string }[];
}

/** 从 ParsedWikiNode + chase excerpts 构造审查输入 */
export function buildSemanticAuditInput(
  node: ParsedWikiNode,
  chaseExcerpts: { index: number; text: string }[],
): SemanticAuditInput {
  return {
    nodeId: node.nodeId,
    filePath: node.filePath,
    title: node.title,
    kind: node.kind,
    frontmatter: node.frontmatter,
    claim: node.sections.claim,
    evidence: node.sections.evidence,
    interpretation: node.sections.interpretation,
    limits: node.sections.limits,
    sourceChase: node.frontmatter.sourceChase ?? [],
    chunkRefs: node.frontmatter.chunkRefs ?? [],
    chaseExcerpts,
  };
}

// ─── Prompt 构造 ──────────────────────────────────────────────────

/**
 * 把 SemanticAuditInput 渲染成 LLM prompt（spec 12.2 + 7.2）。
 *
 * 5 个审查维度：support / addition / inference / limits / citation
 * 输出要求：JSON-only
 */
export function buildSemanticAuditPrompt(input: SemanticAuditInput): string {
  const parts: string[] = [];

  parts.push(`# Semantic Audit Task`);
  parts.push(``);
  parts.push(`You are auditing a wiki node for semantic faithfulness to its source (chase) excerpts.`);
  parts.push(`Do NOT evaluate whether the source is true. Only evaluate whether the wiki node is faithful to the chase excerpts.`);
  parts.push(``);

  // ── Node 身份 ──
  parts.push(`## Node Identity`);
  parts.push(`- nodeId: ${input.nodeId}`);
  parts.push(`- title: ${input.title}`);
  parts.push(`- kind: ${input.kind}`);
  parts.push(`- filePath: ${input.filePath}`);
  parts.push(`- auditStatus: ${input.frontmatter.auditStatus ?? "pending"}`);
  parts.push(``);

  // ── Wiki 节点内容 ──
  parts.push(`## Claim`);
  parts.push(input.claim || "(empty)");
  parts.push(``);
  parts.push(`## Evidence`);
  parts.push(input.evidence.length > 0 ? input.evidence.map((e) => `- ${e}`).join("\n") : "(empty)");
  parts.push(``);
  parts.push(`## Interpretation`);
  parts.push(input.interpretation || "(empty)");
  parts.push(``);
  parts.push(`## Limits`);
  parts.push(input.limits.length > 0 ? input.limits.map((l) => `- ${l}`).join("\n") : "(empty)");
  parts.push(``);

  // ── Chase excerpts（按 chunk 编号） ──
  parts.push(`## Source (chase excerpts)`);
  if (input.chaseExcerpts.length === 0) {
    parts.push(`(no chase excerpt available — citation cannot be verified)`);
  } else {
    for (const ex of input.chaseExcerpts) {
      parts.push(`[Chunk ${ex.index}]`);
      parts.push(ex.text);
      parts.push(``);
    }
  }
  if (input.chunkRefs.length === 0) {
    parts.push(`(missing chunkRefs — citation cannot be verified)`);
  } else {
    parts.push(`Requested chunkRefs: [${input.chunkRefs.join(", ")}]`);
  }
  parts.push(``);

  // ── 审查维度 ──
  parts.push(`## Audit Dimensions`);
  parts.push(`For each dimension, give your assessment:`);
  parts.push(`- **support**: Does the evidence support the claim? (aligned | stretched | unsupported)`);
  parts.push(`- **addition**: Does the wiki add claims not in source? (none | minor | major)`);
  parts.push(`- **inference**: Is inference correctly marked as inference? (ok | warning | failed)`);
  parts.push(`- **limits**: Are important source conditions preserved in Limits? (ok | warning | failed)`);
  parts.push(`- **citation**: Do chunkRefs cover the key evidence? (ok | warning | failed)`);
  parts.push(``);

  // ── 输出格式 ──
  parts.push(`## Output Format`);
  parts.push(`Output JSON only (no prose, no markdown fence). Use this exact shape:`);
  parts.push(`{`);
  parts.push(`  "verdict": "passed" | "warning" | "failed",`);
  parts.push(`  "score": <number 0.0-1.0>,`);
  parts.push(`  "support": "aligned" | "stretched" | "unsupported",`);
  parts.push(`  "addition": "none" | "minor" | "major",`);
  parts.push(`  "inference": "ok" | "warning" | "failed",`);
  parts.push(`  "limits": "ok" | "warning" | "failed",`);
  parts.push(`  "citation": "ok" | "warning" | "failed",`);
  parts.push(`  "issues": [<one short string per problem, in any dimension>]`);
  parts.push(`}`);
  parts.push(``);
  parts.push(`verdict guidance: passed = no issues; warning = minor issues; failed = the wiki distorts the source.`);

  return parts.join("\n");
}

// ─── 响应解析 ──────────────────────────────────────────────────────

/** 合法 verdict 集合 */
const VALID_VERDICTS = new Set(["passed", "warning", "failed"]);

/** 合法 support 集合（spec 7.2） */
const VALID_SUPPORT: SemanticVerdict[] = ["aligned", "stretched", "unsupported"];

/** 合法 addition 集合 */
const VALID_ADDITION = new Set(["none", "minor", "major"]);

/** 合法 ok/warning/failed 集合 */
const VALID_OKWF = new Set(["ok", "warning", "failed"]);

/**
 * 解析 LLM 响应为 SemanticJudgeVerdict。
 *
 * 策略：
 * - 接受纯 JSON 或 ```json ... ``` 包裹
 * - 严格校验每个字段的合法值
 * - 强制把 nodeId 覆盖为 expectedNodeId（防 LLM 错配）
 * - 任一字段缺失或非法 → 抛错
 */
export function parseSemanticAuditResponse(
  text: string,
  expectedNodeId: string,
): SemanticJudgeVerdict {
  const jsonText = extractJsonBlock(text);
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(
      `semantic audit response is not valid JSON: ${(e as Error).message}\n--- response ---\n${text.slice(0, 500)}`,
    );
  }
  if (typeof raw !== "object" || raw === null) {
    throw new Error("semantic audit response is not a JSON object");
  }
  const obj = raw as Record<string, unknown>;

  // verdict
  const verdict = obj.verdict;
  if (typeof verdict !== "string" || !VALID_VERDICTS.has(verdict)) {
    throw new Error(`semantic audit response has invalid verdict: ${String(verdict)}`);
  }

  // score
  const score = obj.score;
  if (typeof score !== "number" || score < 0 || score > 1) {
    throw new Error(`semantic audit response has invalid score: ${String(score)}`);
  }

  // support
  const support = obj.support;
  if (typeof support !== "string" || !VALID_SUPPORT.includes(support as SemanticVerdict)) {
    throw new Error(`semantic audit response has invalid support: ${String(support)}`);
  }

  // addition
  const addition = obj.addition;
  if (typeof addition !== "string" || !VALID_ADDITION.has(addition)) {
    throw new Error(`semantic audit response has invalid addition: ${String(addition)}`);
  }

  // inference / limits / citation
  for (const k of ["inference", "limits", "citation"] as const) {
    const v = obj[k];
    if (typeof v !== "string" || !VALID_OKWF.has(v)) {
      throw new Error(`semantic audit response has invalid ${k}: ${String(v)}`);
    }
  }

  // issues
  const issuesRaw = obj.issues;
  const issues: string[] = [];
  if (Array.isArray(issuesRaw)) {
    for (const item of issuesRaw) {
      if (typeof item === "string") issues.push(item);
    }
  } else if (issuesRaw !== undefined) {
    throw new Error(`semantic audit response has invalid issues: ${String(issuesRaw)}`);
  }

  return {
    nodeId: expectedNodeId, // 强制覆盖
    verdict: verdict as SemanticJudgeVerdict["verdict"],
    score,
    support: support as SemanticVerdict,
    addition: addition as SemanticJudgeVerdict["addition"],
    inference: obj.inference as SemanticJudgeVerdict["inference"],
    limits: obj.limits as SemanticJudgeVerdict["limits"],
    citation: obj.citation as SemanticJudgeVerdict["citation"],
    issues,
  };
}

/** 从 LLM 响应中抽出 JSON 块（兼容 ```json 包裹） */
function extractJsonBlock(text: string): string {
  const trimmed = text.trim();
  // ```json ... ```
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1]!.trim();
  return trimmed;
}
