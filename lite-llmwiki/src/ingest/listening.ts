import { createHash } from "node:crypto";
import type { AppConfig, Evidence, MainThread, Proposition, ProMode, ProResult, Source, WikiFrontmatter, WikiPage } from "../types.js";
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
    const propositions: Proposition[] = rawProps.map((p) => ({
      id: (p.id as number) ?? 0,
      threadId: (p.threadId as number) ?? 0,
      claim: (p.claim as string) ?? "",
      aiReading: (p.aiReading as string) ?? "",
      chunkRefs: Array.isArray(p.chunkRefs) ? (p.chunkRefs as number[]) : [],
      revision: (p.revision as number) ?? 0,
      counterIntuitive: (p.counterIntuitive as boolean) ?? false,
      counterIntuitiveReason: (p.counterIntuitiveReason as string) ?? undefined,
      kind: (p.kind as Proposition["kind"]) ?? undefined,
      evidence: Array.isArray(p.evidence) ? (p.evidence as Evidence[]) : undefined,
      confidence: (p.confidence as number) ?? undefined,
      sourceId: (p.sourceId as string) ?? undefined,
      coverage: (p.coverage as Proposition["coverage"]) ?? undefined,
    }));

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
      chunkRefs: Array.isArray(p?.chunkRefs) ? (p.chunkRefs as number[]) : [],
      revision: (p?.revision as number) ?? 1,
      kind: (p?.kind as Proposition["kind"]) ?? undefined,
      evidence: Array.isArray(p?.evidence) ? (p.evidence as Evidence[]) : undefined,
      confidence: (p?.confidence as number) ?? undefined,
      sourceId: (p?.sourceId as string) ?? undefined,
    };
    return { ...base, mode: "reread", propositions: [prop] };
  }

  // compile
  const rawNodeDrafts = Array.isArray(parsed.nodeDrafts) ? (parsed.nodeDrafts as Record<string, unknown>[]) : [];
  const fallbackSlug = source.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "-").replace(/-+/g, "-").toLowerCase().slice(0, 40).replace(/^-|-$/g, "");
  const nodeDrafts: import("../types.js").WikiNodeDraft[] = rawNodeDrafts.map((d) => ({
    nodeId: (d.nodeId as string) ?? fallbackSlug,
    kind: (d.kind as import("../types.js").WikiKind) ?? "concept",
    filePath: (d.filePath as string) ?? `wiki/concepts/${fallbackSlug}.md`,
    frontmatter: {
      title: (((d.frontmatter as Record<string, unknown>)?.title as string) ?? source.title),
    },
    claim: (d.claim as string) ?? "",
    evidence: Array.isArray(d.evidence) ? (d.evidence as import("../types.js").Evidence[]) : [],
    interpretation: (d.interpretation as string) ?? undefined,
    useFor: Array.isArray(d.useFor) ? (d.useFor as string[]) : undefined,
    limits: Array.isArray(d.limits) ? (d.limits as string[]) : undefined,
    links: Array.isArray(d.links) ? (d.links as string[]) : undefined,
  }));

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
