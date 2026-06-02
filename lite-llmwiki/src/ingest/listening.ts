import { createHash } from "node:crypto";
import type { AppConfig, Evidence, MainThread, Proposition, ProMode, ProResult, Source, WikiFrontmatter, WikiKind, WikiPage } from "../types.js";
import { DeepSeekClient } from "../core/client.js";
import { buildIngestPrefix } from "../core/prefix.js";

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

/**
 * Pro Ingest — 三模式
 *
 * extract: 输出 mainThreads + propositions（含 evidence/kind/coverage）
 * reread:  针对特定 chunk 按 human 新角度重新解读
 * compile: 基于已确认 proposition → wiki pages
 */
export async function proIngest(opts: IngestOpts): Promise<ProResult> {
  const { source, anchor, config, existingNodes, onDelta, signal, mode,
    confirmedPropositionsJson, claim, humanAngle, targetChunkRefs, existingPages } = opts;
  const client = opts.client ?? new DeepSeekClient(config);

  const anchorId = anchor
    ? `anchor-${createHash("sha256").update(anchor).digest("hex").slice(0, 12)}`
    : null;

  const { systemPrompt, userMessage } = buildIngestPrefix({
    config, source, anchor, existingNodes,
    confirmedPropositionsJson, claim, humanAngle, targetChunkRefs, existingPages,
  });

  console.error(`  [Pro] ${mode} — sending...`);
  const result = await client.chat({
    model: config.model,
    systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    responseFormat: "json_object",
    maxTokens: mode === "extract" ? 16384 : mode === "compile" ? 32768 : 4096,
    onStream: onDelta,
    signal,
  });

  return parseProResult(result.content, source, anchorId, anchor, mode);
}

function parseProResult(
  rawJson: string, source: Source, anchorId: string | null,
  anchorText?: string, expectedMode?: ProMode,
): ProResult {
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
      chunkRefs: Array.isArray(t.chunkRefs) ? (t.chunkRefs as number[]) : [],
    }));

    const rawProps = Array.isArray(parsed.propositions)
      ? (parsed.propositions as Record<string, unknown>[]) : [];
    const propositions: Proposition[] = rawProps.map((p) => {
      const chunkRefs = parseNumberArray(p.chunkRefs);
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
        evidence: normalizeEvidenceArray(p.evidence, source.id, chunkRefs),
        confidence: parseConfidence(p.confidence),
        sourceId: (p.sourceId as string) ?? source.id,
        coverage: (p.coverage as Proposition["coverage"]) ?? undefined,
      };
    });

    return { ...base, mode: "extract", mainThreads, propositions };
  }

  if (mode === "reread") {
    // reread 返回单条修订 proposition
    const p = parsed.proposition as Record<string, unknown> | undefined;
    const prop: Proposition = {
      id: (p?.id as number) ?? 0,
      threadId: (p?.threadId as number) ?? 0,
      claim: (p?.claim as string) ?? "",
      aiReading: (p?.aiReading as string) ?? "",
      chunkRefs: parseNumberArray(p?.chunkRefs),
      revision: (p?.revision as number) ?? 1,
      kind: parseWikiKind(p?.kind),
      evidence: normalizeEvidenceArray(p?.evidence, source.id, parseNumberArray(p?.chunkRefs)),
      confidence: parseConfidence(p?.confidence),
      sourceId: (p?.sourceId as string) ?? source.id,
    };
    return { ...base, mode: "reread", propositions: [prop] };
  }

  // compile
  const rawNodeDrafts = Array.isArray(parsed.nodeDrafts) ? (parsed.nodeDrafts as Record<string, unknown>[]) : [];
  const fallbackSlug = source.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "-").replace(/-+/g, "-").toLowerCase().slice(0, 40).replace(/^-|-$/g, "");
  const parsedNodeDrafts: import("../types.js").WikiNodeDraft[] = rawNodeDrafts.map((d) => {
    const rawFm = isRecord(d.frontmatter) ? d.frontmatter : {};
    const nodeId = (d.nodeId as string) ?? (rawFm.nodeId as string) ?? `concept/${fallbackSlug}`;
    const kind = parseWikiKind(d.kind ?? rawFm.kind) ?? "concept";
    const evidence = normalizeEvidenceArray(d.evidence, source.id, parseNumberArray(d.chunkRefs ?? rawFm.chunkRefs));
    const chunkRefs = uniqueNumbers([
      ...parseNumberArray(rawFm.chunkRefs),
      ...parseNumberArray(d.chunkRefs),
      ...evidence.flatMap((ev) => ev.chunkRefs),
    ]);
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
    const fbSlug = source.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "-").replace(/-+/g, "-").toLowerCase().slice(0, 40).replace(/^-|-$/g, "");
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

function normalizeEvidenceArray(value: unknown, fallbackSourceId: string, fallbackChunkRefs: number[]): Evidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => {
      const chunkRefs = uniqueNumbers([
        ...parseNumberArray(item.chunkRefs),
        ...parseNumberArray(item.chunkRef),
        ...fallbackChunkRefs,
      ]);
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
  const fallbackSlug = nodeId.replace(/^[^/]+\//, "").replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "-");
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
