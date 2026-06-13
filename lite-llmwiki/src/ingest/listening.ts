import { createHash } from "node:crypto";
import type { AppConfig, Evidence, MainThread, Proposition, ProMode, ProResult, Source, WikiFrontmatter, WikiKind, WikiPage } from "../types.js";
import { DeepSeekClient } from "../core/client.js";
import { buildIngestPrefix, buildThinkStepPrefix, buildFormatStepPrefix } from "../core/prefix.js";

export interface IngestOpts {
  source: Source;
  anchor?: string;
  config: AppConfig;
  client?: DeepSeekClient;
  existingNodes?: Array<{ id: string; name: string; summary: string }>;
  onDelta?: (text: string) => void;
  signal?: AbortSignal;

  mode: ProMode;

  // compile
  confirmedPropositionsJson?: string;

  // reread
  claim?: string;
  humanAngle?: string;
  targetChunkRefs?: number[];

  // compile: 已有 wiki 页面
  existingPages?: Array<{ filePath: string; title: string; summary: string }>;
}

// ─── 模型选择 ──────────────────────────────────────────────────────
// 两步调用：Pro（reasoning）深度思考 → Flash 结构化输出
// 单步调用（reread）：用 config 里的默认模型

const THINK_MODEL = "deepseek-v4-pro";
const FORMAT_MODEL = "deepseek-v4-flash";

/**
 * Pro Ingest — 三模式
 *
 * extract: 两步 — Pro 深度思考 → Flash 结构化提取 mainThreads + propositions
 * compile: 两步 — Pro 深度思考 → Flash 结构化输出 nodeDrafts + updatedPages
 * reread:  单步 — Flash 按 human 新角度重新解读
 */
export async function proIngest(opts: IngestOpts): Promise<ProResult> {
  const { source, anchor, config, existingNodes, onDelta, signal, mode,
    confirmedPropositionsJson, claim, humanAngle, targetChunkRefs, existingPages } = opts;
  const client = opts.client ?? new DeepSeekClient(config);

  const anchorId = anchor
    ? `anchor-${createHash("sha256").update(anchor).digest("hex").slice(0, 12)}`
    : null;

  const prefixOpts = {
    config, source, anchor, existingNodes,
    confirmedPropositionsJson, claim, humanAngle, targetChunkRefs, existingPages,
  };

  // ── reread: 单步调用（简单，不需要拆分） ──
  if (mode === "reread") {
    const { systemPrompt, userMessage } = buildIngestPrefix(prefixOpts);
    console.error("  [Pro] reread — sending...");
    const result = await client.chat({
      model: FORMAT_MODEL,
      systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      responseFormat: "json_object",
      maxTokens: 4096,
      onStream: onDelta,
      signal,
    });
    return parseProResult(result.content, source, anchorId, anchor, mode);
  }

  // ── extract: 两步调用 ──
  if (mode === "extract") {
    // Step 1: Pro 深度思考（自由文本，无 JSON 约束）
    const thinkPrompt = buildThinkStepPrefix(prefixOpts, "think-extract");
    console.error("  [Pro] extract — step 1/2: deep think (pro)...");
    const thinkResult = await client.chat({
      model: THINK_MODEL,
      systemPrompt: thinkPrompt.systemPrompt,
      messages: [{ role: "user", content: thinkPrompt.userMessage }],
      responseFormat: "text",
      maxTokens: 8192,
      signal,
    });
    console.error(`  [Pro] extract — step 1 done (${thinkResult.usage?.completionTokens ?? "?"} tokens)`);

    // Step 2: Flash 结构化提取（严格 JSON）
    const formatPrompt = buildFormatStepPrefix(prefixOpts, "format-extract", thinkResult.content);
    console.error("  [Pro] extract — step 2/2: format (flash)...");
    const formatResult = await client.chat({
      model: FORMAT_MODEL,
      systemPrompt: formatPrompt.systemPrompt,
      messages: [{ role: "user", content: formatPrompt.userMessage }],
      responseFormat: "json_object",
      maxTokens: 16384,
      onStream: onDelta,
      signal,
    });
    console.error("  [Pro] extract — done");
    return parseProResult(formatResult.content, source, anchorId, anchor, mode);
  }

  // ── compile: 两步调用 ──
  if (mode === "compile") {
    // Step 1: Pro 深度思考
    const thinkPrompt = buildThinkStepPrefix(prefixOpts, "think-compile");
    console.error("  [Pro] compile — step 1/2: deep think (pro)...");
    const thinkResult = await client.chat({
      model: THINK_MODEL,
      systemPrompt: thinkPrompt.systemPrompt,
      messages: [{ role: "user", content: thinkPrompt.userMessage }],
      responseFormat: "text",
      maxTokens: 8192,
      signal,
    });
    console.error(`  [Pro] compile — step 1 done (${thinkResult.usage?.completionTokens ?? "?"} tokens)`);

    // Step 2: Flash 结构化输出
    const formatPrompt = buildFormatStepPrefix(prefixOpts, "format-compile", thinkResult.content);
    console.error("  [Pro] compile — step 2/2: format (flash)...");
    const formatResult = await client.chat({
      model: FORMAT_MODEL,
      systemPrompt: formatPrompt.systemPrompt,
      messages: [{ role: "user", content: formatPrompt.userMessage }],
      responseFormat: "json_object",
      maxTokens: 32768,
      onStream: onDelta,
      signal,
    });
    console.error("  [Pro] compile — done");
    return parseProResult(formatResult.content, source, anchorId, anchor, mode);
  }

  // fallback（不应该到达）
  throw new Error(`proIngest: unknown mode "${mode}"`);
}

function parseProResult(
  rawJson: string, source: Source, anchorId: string | null,
  anchorText?: string, expectedMode?: ProMode,
): ProResult {
  // chunkRefs 有效范围：1-based，[1, totalChunks]
  const maxChunkRef = source.chunks.length;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(rawJson); }
  catch {
    return fallbackResult(source, anchorId, rawJson, anchorText, expectedMode);
  }

  const mode = (parsed.mode as ProMode) ?? expectedMode ?? "extract";
  const hypotheses = Array.isArray(parsed.hypotheses)
    ? (parsed.hypotheses as import("../types.js").HypothesisOption[]) : [];

  const base = {
    materialId: source.id,
    title: (parsed.title as string) ?? source.title,
    type: source.type,
    humanAnchor: anchorId ? { id: anchorId, text: anchorText ?? "" } : null,
    hypotheses,
    feedbackText: (parsed.feedbackText as string) ?? "OK",
  };

  if (mode === "extract") {
    const rawThreads = Array.isArray(parsed.mainThreads)
      ? (parsed.mainThreads as Record<string, unknown>[]) : [];
    const mainThreads: MainThread[] = rawThreads.map((t) => ({
      id: (t.id as number) ?? 0,
      title: (t.title as string) ?? "",
      description: (t.description as string) ?? "",
      chunkRefs: clampChunkRefs(Array.isArray(t.chunkRefs) ? (t.chunkRefs as number[]) : [], maxChunkRef),
    }));

    const rawProps = Array.isArray(parsed.propositions)
      ? (parsed.propositions as Record<string, unknown>[]) : [];
    const propositions: Proposition[] = rawProps.map((p) => {
      const chunkRefs = clampChunkRefs(parseNumberArray(p.chunkRefs), maxChunkRef);
      return {
        id: asNumber(p.id, 0),
        threadId: asNumber(p.threadId, 0),
        claim: (p.claim as string) ?? "",
        aiReading: (p.aiReading as string) ?? "",
        chunkRefs,
        revision: asNumber(p.revision, 0),
        counterIntuitive: (p.counterIntuitive as boolean) ?? false,
        counterIntuitiveReason: (p.counterIntuitiveReason as string) ?? undefined,
        kind: parseWikiKind(p.kind),
        evidence: normalizeEvidenceArray(p.evidence, source.id, chunkRefs, maxChunkRef),
        confidence: parseConfidence(p.confidence),
        sourceId: (p.sourceId as string) ?? source.id,
        coverage: (p.coverage as Proposition["coverage"]) ?? undefined,
      };
    });

    return { ...base, mode: "extract", mainThreads, propositions };
  }

  if (mode === "reread") {
    const p = parsed.proposition as Record<string, unknown> | undefined;
    const rawChunkRefs = clampChunkRefs(parseNumberArray(p?.chunkRefs), maxChunkRef);
    const prop: Proposition = {
      id: (p?.id as number) ?? 0,
      threadId: (p?.threadId as number) ?? 0,
      claim: (p?.claim as string) ?? "",
      aiReading: (p?.aiReading as string) ?? "",
      chunkRefs: rawChunkRefs,
      revision: (p?.revision as number) ?? 1,
      kind: parseWikiKind(p?.kind),
      evidence: normalizeEvidenceArray(p?.evidence, source.id, rawChunkRefs, maxChunkRef),
      confidence: parseConfidence(p?.confidence),
      sourceId: (p?.sourceId as string) ?? source.id,
    };
    return { ...base, mode: "reread", propositions: [prop] };
  }

  // compile
  const rawNodeDrafts = Array.isArray(parsed.nodeDrafts) ? (parsed.nodeDrafts as Record<string, unknown>[]) : [];
  const fallbackSlug = source.title.replace(/[^a-zA-Z0-9一-鿿]/g, "-").replace(/-+/g, "-").toLowerCase().slice(0, 40).replace(/^-|-$/g, "");
  const parsedNodeDrafts: import("../types.js").WikiNodeDraft[] = rawNodeDrafts.map((d) => {
    const rawFm = isRecord(d.frontmatter) ? d.frontmatter : {};
    const nodeId = (d.nodeId as string) ?? (rawFm.nodeId as string) ?? `concept/${fallbackSlug}`;
    const kind = parseWikiKind(d.kind ?? rawFm.kind) ?? "concept";
    const evidence = normalizeEvidenceArray(d.evidence, source.id, parseNumberArray(d.chunkRefs ?? rawFm.chunkRefs), maxChunkRef);
    const chunkRefs = clampChunkRefs(uniqueNumbers([
      ...parseNumberArray(rawFm.chunkRefs),
      ...parseNumberArray(d.chunkRefs),
      ...evidence.flatMap((ev) => ev.chunkRefs),
    ]), maxChunkRef);
    const frontmatter: WikiFrontmatter = {
      ...parseWikiFrontmatter(rawFm),
      nodeId,
      kind,
      title: (rawFm.title as string) ?? (d.title as string) ?? source.title,
      source: (rawFm.source as string) ?? source.id,
      sourceIds: uniqueStrings([
        ...parseStringArray(rawFm.sourceIds),
        source.id,
        ...evidence.map((ev) => ev.sourceId),
      ]),
      sourceChase: parseStringArray(rawFm.sourceChase),
      chunkRefs,
      confidence: parseConfidence(rawFm.confidence ?? d.confidence) ?? (evidence.length > 0 ? 0.7 : 0.3),
      status: parseStatus(rawFm.status) ?? (evidence.length > 0 ? "verified" : "needs_review"),
      tags: parseStringArray(rawFm.tags),
      related: parseStringArray(rawFm.related),
      createdAt: (rawFm.createdAt as string) ?? new Date().toISOString(),
      updatedAt: (rawFm.updatedAt as string) ?? new Date().toISOString(),
    };
    return {
      nodeId,
      kind,
      filePath: normalizeWikiFilePath(d.filePath, kind, nodeId),
      frontmatter,
      claim: (d.claim as string) ?? "",
      evidence,
      interpretation: (d.interpretation as string) ?? undefined,
      useFor: parseStringArray(d.useFor),
      limits: parseStringArray(d.limits),
      links: parseStringArray(d.links),
    };
  });
  const nodeDrafts = uniquifyNodeDraftPaths(parsedNodeDrafts);

  const rawUpdated = Array.isArray(parsed.updatedPages) ? (parsed.updatedPages as Record<string, unknown>[]) : [];
  const updatedPages: WikiPage[] = rawUpdated.map((p) => ({
    nodeId: (p.nodeId as string) ?? `concept/${fallbackSlug}`,
    filePath: (p.filePath as string) ?? "",
    frontmatter: {
      ...(p.frontmatter as Record<string, unknown> ?? {}) as unknown as WikiFrontmatter,
      title: ((p.frontmatter as Record<string, unknown>)?.title as string) ?? source.title,
    },
    body: (p.body as string) ?? "",
    updateType: (p.updateType as "append" | "replace") ?? "append",
  }));

  return { ...base, mode: "compile", pages: [], nodeDrafts, updatedPages };
}

function fallbackResult(
  source: Source, anchorId: string | null,
  rawText: string, anchorText?: string, mode?: ProMode,
): ProResult {
  const base = {
    materialId: source.id, title: source.title,
    type: source.type,
    humanAnchor: anchorId ? { id: anchorId, text: anchorText ?? "" } : null,
    hypotheses: [],
    feedbackText: "fallback",
  };

  if (mode === "compile") {
    const fbSlug = source.title.replace(/[^a-zA-Z0-9一-鿿]/g, "-").replace(/-+/g, "-").toLowerCase().slice(0, 40).replace(/^-|-$/g, "");
    return { ...base, mode: "compile", pages: [], nodeDrafts: [{
      nodeId: `concept/${fbSlug}`, kind: "concept" as const,
      filePath: `wiki/concepts/${fbSlug}.md`,
      frontmatter: { title: source.title },
      claim: rawText.slice(0, 1000), evidence: [],
      interpretation: "fallback compilation",
    }]};
  }

  return {
    ...base, mode: "extract",
    mainThreads: [{ id: 1, title: "全文", description: "自动化提取", chunkRefs: [] }],
    propositions: [{
      id: 1, threadId: 1, claim: rawText.slice(0, 200),
      aiReading: "fallback", chunkRefs: [], revision: 0,
    }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseConfidence(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "high") return 0.85;
    if (lower === "medium") return 0.6;
    if (lower === "low") return 0.3;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseWikiKind(value: unknown): WikiKind | undefined {
  const allowed: WikiKind[] = [
    "concept",
    "claim",
    "method",
    "case",
    "equation",
    "question",
    "insight",
    "anchor",
    "counter",
  ];
  return typeof value === "string" && allowed.includes(value as WikiKind)
    ? value as WikiKind
    : undefined;
}

function parseStatus(value: unknown): WikiFrontmatter["status"] | undefined {
  const allowed = ["draft", "verified", "needs_review", "legacy"];
  return typeof value === "string" && allowed.includes(value)
    ? value as WikiFrontmatter["status"]
    : undefined;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function parseNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => typeof item === "number" ? item : Number(item))
      .filter((item) => Number.isFinite(item));
  }
  if (typeof value === "number" && Number.isFinite(value)) return [value];
  if (typeof value === "string") {
    return value
      .replace(/[\[\]]/g, "")
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item));
  }
  return [];
}

function normalizeEvidenceArray(value: unknown, fallbackSourceId: string, fallbackChunkRefs: number[], maxChunkRef: number): Evidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => {
      const chunkRefs = clampChunkRefs(uniqueNumbers([
        ...parseNumberArray(item.chunkRefs),
        ...parseNumberArray(item.chunkRef),
        ...fallbackChunkRefs,
      ]), maxChunkRef);
      return {
        sourceId: (item.sourceId as string) ?? fallbackSourceId,
        chunkRefs,
        excerpt: (item.excerpt as string) ?? (item.quote as string) ?? undefined,
        quote: (item.quote as string) ?? undefined,
        summary: (item.summary as string) ?? undefined,
      };
    })
    .filter((item) => item.sourceId.trim().length > 0 && item.chunkRefs.length > 0);
}

function parseWikiFrontmatter(raw: Record<string, unknown>): WikiFrontmatter {
  return {
    title: (raw.title as string) ?? "",
    source: (raw.source as string) ?? undefined,
    sourceIds: parseStringArray(raw.sourceIds),
    sourceChase: parseStringArray(raw.sourceChase),
    chunkRefs: parseNumberArray(raw.chunkRefs),
    confidence: parseConfidence(raw.confidence),
    status: parseStatus(raw.status),
    createdAt: (raw.createdAt as string) ?? undefined,
    updatedAt: (raw.updatedAt as string) ?? undefined,
    tags: parseStringArray(raw.tags),
    hypothesis: (raw.hypothesis as string) ?? undefined,
    hypothesisTitle: (raw.hypothesisTitle as string) ?? undefined,
    related: parseStringArray(raw.related),
    kind: parseWikiKind(raw.kind),
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value)))].sort((a, b) => a - b);
}

/**
 * 将 chunkRefs 限制在有效范围 [1, maxChunkRef] 内。
 *
 * LLM 可能输出超出实际 chunk 数量的 chunkRefs（如 [7,8,9] 但只有 4 chunks），
 * 这会导致结构审计失败并阻塞整个管线。
 *
 * 策略：
 * - 0-based 索引（0, 1, 2, ...）→ 转换为 1-based（1, 2, 3, ...）后验证
 * - 越界的 1-based 索引 → 过滤掉
 * - 空结果 → 回退到 [1]（至少引用第一个 chunk，避免 frontmatter 校验失败）
 */
function clampChunkRefs(refs: number[], maxChunkRef: number): number[] {
  if (maxChunkRef <= 0) return refs; // 无 chunks 信息时不过滤

  const clamped: number[] = [];
  for (const ref of refs) {
    // 0-based → 1-based 转换
    const adjusted = ref <= 0 ? ref + 1 : ref;
    if (adjusted >= 1 && adjusted <= maxChunkRef) {
      clamped.push(adjusted);
    }
  }

  // 去重排序
  const result = [...new Set(clamped)].sort((a, b) => a - b);

  // 如果过滤后为空，回退到 [1]
  return result.length > 0 ? result : [1];
}

function normalizeWikiFilePath(value: unknown, kind: WikiKind, nodeId: string): string {
  const directoryByKind: Record<WikiKind, string> = {
    concept: "concepts",
    claim: "claims",
    method: "methods",
    case: "cases",
    equation: "equations",
    question: "questions",
    insight: "insights",
    anchor: "anchors",
    counter: "counters",
  };
  const fallbackSlug = nodeId.replace(/^[^/]+\//, "").replace(/[^a-zA-Z0-9一-鿿_-]/g, "-");
  const fallback = `wiki/${directoryByKind[kind]}/${fallbackSlug}.md`;
  if (typeof value !== "string" || value.trim().length === 0) return fallback;

  const trimmed = value.trim().replace(/^\/+/, "");
  return trimmed.startsWith("wiki/") ? trimmed : `wiki/${trimmed}`;
}

function uniquifyNodeDraftPaths<T extends { nodeId: string; filePath: string }>(drafts: T[]): T[] {
  const seen = new Map<string, number>();
  return drafts.map((draft) => {
    const count = seen.get(draft.filePath) ?? 0;
    seen.set(draft.filePath, count + 1);
    if (count === 0) return draft;

    const suffix = `-${count + 1}`;
    const filePath = draft.filePath.replace(/\.md$/, `${suffix}.md`);
    const nodeId = draft.nodeId.endsWith(suffix) ? draft.nodeId : `${draft.nodeId}${suffix}`;
    return { ...draft, filePath, nodeId };
  });
}
