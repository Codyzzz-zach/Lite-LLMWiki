/**
 * query — evidence-aware knowledge query engine
 *
 * 流程：
 *  1. 本地 searchWiki 检索相关节点 (不调 LLM)
 *  2. 组装结构化上下文 (nodeId / Claim / Evidence / Interpretation / Limits)
 *  3. 发送给 LLM 生成回答，强制只基于 evidence 输出事实
 */
import type { AppConfig } from "../types.js";
import { DeepSeekClient } from "../core/client.js";
import { searchWiki } from "./search.js";
import type { SearchMatch, SearchOptions } from "./search.js";

// ─── 导出类型 ────────────────────────────────────────────────────────

export interface QueryOptions {
  question: string;
  config: AppConfig;
  signal?: AbortSignal;
  /** 最多检索多少条节点，默认 5 */
  maxNodes?: number;
  /** 是否包含缺乏 evidence 的 legacy 页面，默认 false */
  includeLegacy?: boolean;
}

export interface QuerySource {
  nodeId: string;
  kind: string;
  title: string;
  filePath: string;
  claim: string;
  evidence: string[];
}

export interface QueryResult {
  /** 自然语言回答 */
  answer: string;
  /** 引用的知识节点列表 */
  sources: QuerySource[];
  /** 模型标注的推断/迁移建议（非 raw evidence 直接支持） */
  inferences: string[];
  /** 知识库中缺乏的信息主题 */
  missingEvidence: string[];
  /** token 用量 */
  usage: { promptTokens: number; completionTokens: number } | null;
}

// ─── Prompt ──────────────────────────────────────────────────────────

const QUERY_SYSTEM_PROMPT = `你是 lite-llmwiki 的知识查询助手，职责是基于用户已编译的知识库节点回答问题。

## 上下文格式说明

每个节点包含：
- Node: 节点 ID
- Kind: 节点种类 (concept / method / case / ...)
- Title: 标题
- Claim: 核心主张（原文可支持的事实）
- Evidence: 证据列表（来自 raw/chase 的原文摘录或摘要）
- Interpretation: AI 对 claim 的解读和迁移
- Limits: 已知限制

## 回答规则

1. **事实回答只使用 Claim / Evidence**。Interpretation 只作为参考，不作为直接事实引用。
2. **引用来源**：回答时标注对应的 nodeId 或 title。
3. **可迁移建议**：如果要给出基于 knowledge 的推断或启发，必须标注为"基于 wiki 的推断"。
4. **信息不足**：如果 wiki 节点不足以回答问题，明确列出缺失的信息 (missing evidence)。
5. **不要编造**：不引用 wiki 节点中不存在的事实。
6. 回答用中文。`;

// ─── 主入口 ──────────────────────────────────────────────────────────

/**
 * 基于 wiki 知识库回答用户问题，使用 evidence-aware 上下文
 */
export async function queryKnowledge(opts: QueryOptions): Promise<QueryResult> {
  const { question, config, signal, maxNodes = 5, includeLegacy = false } = opts;

  // 1. 本地检索相关节点（不需要 API key）
  const searchOpts: SearchOptions = { maxResults: maxNodes };
  const matches = searchWiki(config, question, searchOpts);

  // 过滤掉没有 evidence 的 legacy 节点（除非显式要求包含）
  let filtered = matches;
  if (!includeLegacy) {
    filtered = matches.filter((m) => m.evidence.length > 0);
  }

  if (filtered.length === 0) {
    // 退一步：如果有无 evidence 的 legacy 匹配，也返回信息
    if (matches.length > 0 && !includeLegacy) {
      return {
        answer:
          "知识库中找到相关页面，但缺少可验证的 evidence。可通过 `--include-legacy` 查看，或重新 ingest 生成带 evidence 的 v5 节点。",
        sources: matches.map(toSource),
        inferences: [],
        missingEvidence: ["相关节点缺少 evidence 链，无法基于 evidence 回答"],
        usage: null,
      };
    }
    return {
      answer: "知识库中目前没有找到与问题相关的节点。",
      sources: [],
      inferences: [],
      missingEvidence: [],
      usage: null,
    };
  }

  // 2. 组装结构化上下文
  const contextBlocks = filtered.map((m) => formatNodeContext(m));
  const contextStr = contextBlocks.join("\n\n---\n\n");

  const userMessage = `## 用户问题\n${question}\n\n## 知识库相关内容\n\n${contextStr}\n\n请基于以上 wiki 内容回答问题，并注明引用来源。如果信息不足，列出缺失的证据。`;

  // 3. 调用 LLM（延迟创建 client，避免无 API key 时也报错）
  const client = new DeepSeekClient(config);
  const result = await client.chat({
    model: config.model,
    systemPrompt: QUERY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    signal,
  });

  // 4. 从回答中提取 inferences 和 missingEvidence
  const { inferences, missingEvidence } = extractAnnotations(result.content);

  return {
    answer: result.content,
    sources: filtered.map(toSource),
    inferences,
    missingEvidence,
    usage: result.usage
      ? {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
        }
      : null,
  };
}

// ─── 辅助函数 ────────────────────────────────────────────────────────

/** 将 SearchMatch 转为结构化上下文文本块 */
function formatNodeContext(m: SearchMatch): string {
  const lines: string[] = [];
  lines.push(`Node: ${m.nodeId}`);
  lines.push(`Kind: ${m.kind}`);
  lines.push(`Title: ${m.title}`);
  lines.push(`Claim: ${m.claim || "（无明确主张）"}`);

  if (m.evidence.length > 0) {
    lines.push("Evidence:");
    for (const ev of m.evidence) {
      lines.push(`- ${ev}`);
    }
  }

  return lines.join("\n");
}

/** 将 SearchMatch 转为 QuerySource */
function toSource(m: SearchMatch): QuerySource {
  return {
    nodeId: m.nodeId,
    kind: m.kind,
    title: m.title,
    filePath: m.filePath,
    claim: m.claim,
    evidence: m.evidence,
  };
}

/**
 * 从 LLM 回答文本中提取 inferences 和 missingEvidence 标注。
 *
 * 规则：
 * - 包含 "基于 wiki 的推断"、"推测" 等关键词的行 → inference
 * - 包含 "缺失"、"缺少"、"没有找到"、"信息不足" 等关键词 → missingEvidence
 */
export function extractAnnotations(answer: string): {
  inferences: string[];
  missingEvidence: string[];
} {
  const lines = answer.split("\n");
  const inferences: string[] = [];
  const missingEvidence: string[] = [];

  const inferencePatterns = [/基于 wiki 的推断/i, /推测/i, /推断/i, /可迁移/i];
  const missingPatterns = [/缺失/i, /缺少/i, /没有找到/i, /信息不足/i, /没有足够的信息/i];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---")) continue;

    // 跳过纯引用行
    if (/^[•\-*]\s*(Node|Kind|Title|Claim|Evidence|Interpretation)/i.test(trimmed)) continue;

    if (inferencePatterns.some((p) => p.test(trimmed))) {
      inferences.push(trimmed.replace(/^[•\-*\s]+/, ""));
    }

    if (missingPatterns.some((p) => p.test(trimmed))) {
      missingEvidence.push(trimmed.replace(/^[•\-*\s]+/, ""));
    }
  }

  return { inferences, missingEvidence };
}
