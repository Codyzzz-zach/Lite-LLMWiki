/**
 * lite-llmwiki 核心类型定义
 *
 * 三模式：extract（初读 → 主线 + proposition，含 evidence/kind/coverage）
 *         reread（单条 proposition 按新角度重读）
 *         compile（已确认 proposition → wiki pages）
 */

// ─── Source（原始材料） ────────────────────────────────────────────

export interface Source {
  id: string;
  path: string;
  /** 原始材料根路径。TeX 通常是项目文件夹，MD/PDF 通常等于 path。 */
  sourceRoot?: string;
  type: "md" | "pdf" | "tex";
  title: string;
  meta: Record<string, string>;
  body: string;
  chunks: Chunk[];
  totalTokens: number;
  createdAt: Date;
  fingerprint: string;
}

export interface Chunk {
  id: string;
  index: number;
  text: string;
  tokenEstimate: number;
  charStart: number;
  charEnd: number;
}

// ─── Phase 1: Extract 主线 ─────────────────────────────────────

export interface MainThread {
  /** 1-based 编号 */
  id: number;
  /** 主线标题 */
  title: string;
  /** 一句话描述 */
  description: string;
  /** 涉及的 chunk 索引 */
  chunkRefs: number[];
}

// ─── Phase 2: Proposition（对齐提案） ─────────────────────────────

export interface Proposition {
  /** 1-based 编号 */
  id: number;
  /** 所属主线 id */
  threadId: number;
  /** raw 中的事实主张 */
  claim: string;
  /** AI 基于事实的解读 */
  aiReading: string;
  /** 关联 chunk 索引 */
  chunkRefs: number[];
  /** 修订版本号：0=原始, 1-3=m 触发次数 */
  revision: number;
  /** 可选：这个结论是否挑战了人类的常见认知/经验习惯 */
  counterIntuitive?: boolean;
  /** 反直觉的理由——具体说明挑战了什么认知习惯 */
  counterIntuitiveReason?: string;
  /** proposition 种类 */
  kind?: WikiKind;
  /** 证据链 */
  evidence?: Evidence[];
  /** 置信度 0-1 */
  confidence?: number;
  /** 来源材料 ID */
  sourceId?: string;
  /** extract 阶段：与已有 wiki 页面的覆盖关系 */
  coverage?: CoverageInfo;
}

// ─── Confirm 状态 ──────────────────────────────────────────────────

export type PropConfirm = "confirmed" | "skip";

export interface ConfirmedProposition {
  propId: number;
  threadId: number;
  claim: string;
  /** 最终版本的 aiReading（可能经过 m 修订）*/
  aiReading: string;
  chunkRefs: number[];
  revision: number;
  status: PropConfirm;
  /** 是否标注为反直觉 */
  counterIntuitive?: boolean;
  counterIntuitiveReason?: string;
}

// ─── Compile 输出 ──────────────────────────────────────────────────

export type WikiKind =
  | "concept"
  | "claim"
  | "method"
  | "case"
  | "equation"
  | "question"
  | "insight"
  | "anchor"
  | "counter";

/** 证据链：将 wiki 条目中的主张链接回原始材料 */
export interface Evidence {
  /** 来源材料 ID */
  sourceId: string;
  /** 涉及 chunk 索引 */
  chunkRefs: number[];
  /** 原文摘录（可选）*/
  excerpt?: string;
  /** 原文短引用（兼容 spec 命名） */
  quote?: string;
  /** 证据摘要，供 agent 快速理解 */
  summary?: string;
}

/** extract 阶段：proposition 与已有 wiki 的覆盖关系 */
export interface CoverageInfo {
  /** "new" | "overlap" | "extension" */
  status: string;
  /** 与已有 wiki 页面重叠/扩展时，关联的 filePath 列表 */
  relatedPages?: string[];
}

// ─── v6 审计与 Board 类型 ──────────────────────────────────────────

export type AuditStatus = "pending" | "passed" | "warning" | "failed";
export type ClaimType =
  | "source_claim"
  | "interpretation"
  | "application"
  | "analogy"
  | "question"
  | "counter";
export type InferenceLevel = "none" | "light" | "medium" | "strong";
export type BoardRole =
  | "evidence"
  | "concept"
  | "method"
  | "case"
  | "limit"
  | "counter"
  | "question"
  | "anchor"
  | "bridge";
export type BoardMode =
  | "ask"
  | "trace"
  | "expand"
  | "compare"
  | "challenge"
  | "inspire";

/**
 * v5 → v6 模式别名（spec 8.2）。
 * 在 CLI / engine 入口处归一化，类型层只保留 v6 命名。
 */
export const BOARD_MODE_ALIASES: Readonly<Record<string, BoardMode>> = {
  exact: "trace",
  explore: "expand",
  counter: "challenge",
};

const BOARD_MODE_VALUES: readonly BoardMode[] = [
  "ask",
  "trace",
  "expand",
  "compare",
  "challenge",
  "inspire",
];

/** 把任意输入归一化为合法 BoardMode；无法识别时回退到 `ask`。 */
export function normalizeBoardMode(input: string | undefined | null): BoardMode {
  if (!input) return "ask";
  const lower = input.toLowerCase();
  if ((BOARD_MODE_VALUES as readonly string[]).includes(lower)) {
    return lower as BoardMode;
  }
  return BOARD_MODE_ALIASES[lower] ?? "ask";
}

/** 覆盖记录：跟踪 proposition 已被哪些 wiki 页面覆盖 */
export interface CoverageItem {
  /** proposition 编号 */
  propId: number;
  /** 覆盖到的 wiki 页面 filePath */
  coveredIn: string;
  /** 覆盖日期 */
  coveredAt: Date;
}

/** wiki 页面 frontmatter 结构化类型（v5 + v6 扩展） */
export interface WikiFrontmatter {
  /** 稳定节点 ID，未来 graph node primary key */
  nodeId?: string;
  title: string;
  /** 来源材料 ID */
  source?: string;
  /** v5 多来源 ID */
  sourceIds?: string[];
  /** v5 清洗后输入层路径 */
  sourceChase?: string[];
  /** v5 证据 chunk 引用 */
  chunkRefs?: number[];
  /** 置信度 0-1 */
  confidence?: number;
  /** v5 节点状态 */
  status?: "draft" | "verified" | "needs_review" | "legacy";
  /** 创建时间 ISO 字符串 */
  createdAt?: string;
  /** 更新时间 ISO 字符串 */
  updatedAt?: string;
  /** v5 检索/聚类标签 */
  tags?: string[];
  /** 关联假设 id */
  hypothesis?: string;
  /** 关联假设标题 */
  hypothesisTitle?: string;
  /** 关联页面路径列表 */
  related?: string[];
  /** wiki 页面种类 */
  kind?: WikiKind;
  /** 本条目的证据链 */
  evidence?: Evidence[];
  // v6 字段（可选，向后兼容）
  auditStatus?: AuditStatus;
  auditScore?: number;
  claimType?: ClaimType;
  inferenceLevel?: InferenceLevel;
  propRefs?: string[];
  claimHash?: string;
  boardRoles?: BoardRole[];
}

export interface ValidatedWikiFrontmatter extends WikiFrontmatter {
  nodeId: string;
  kind: WikiKind;
  sourceIds: string[];
  sourceChase: string[];
  chunkRefs: number[];
  confidence: number;
  status: "draft" | "verified" | "needs_review" | "legacy";
  tags: string[];
  related: string[];
  createdAt: string;
  updatedAt: string;
  // v6 字段（全部保留，缺省时由 normalizeFrontmatter 给出合理默认值）
  auditStatus: AuditStatus;
  auditScore?: number;
  claimType?: ClaimType;
  inferenceLevel?: InferenceLevel;
  propRefs?: string[];
  claimHash?: string;
  boardRoles?: BoardRole[];
}

export interface WikiNodeDraft {
  nodeId: string;
  kind: WikiKind;
  filePath: string;
  frontmatter: WikiFrontmatter;
  claim: string;
  evidence: Evidence[];
  interpretation?: string;
  useFor?: string[];
  limits?: string[];
  links?: string[];
  // v6 sections (spec 6.3)
  /** semantic audit 的人类可读说明（## Audit Notes） */
  auditNotes?: string;
  /** 该节点适合在什么 query 局面中被召回（## Board Use） */
  boardUse?: string[];
}

export interface WikiPage {
  nodeId: string;
  filePath: string;
  frontmatter: WikiFrontmatter;
  body: string;
  /** compile 输出: append 追加到已有页面末尾, replace 替换整个 body */
  updateType?: "append" | "replace";
}

export interface HypothesisOption {
  id: string;
  title: string;
  relevantNodes: string[];
  logic: string;
  actionability?: string;
}

// ─── v6 Query Output (spec 9.1) ────────────────────────────────────

/** wiki claim 引用（spec 9.1 fromWiki） */
export interface WikiClaimRef {
  claim: string;
  nodeId: string;
  filePath: string;
  chunkRefs: number[];
  /** 该 claim 对应的 board role（evidence / concept / method / ...） */
  boardRole?: BoardRole;
}

/** 模型综合（spec 9.1 modelSynthesis） */
export interface ModelSynthesis {
  text: string;
  /** 基于的 node id 列表 */
  basedOn: string[];
  /** 模型自评的置信度（low / medium / high） */
  confidence: "low" | "medium" | "high";
}

/** 缺失证据（spec 9.1 missingEvidence） */
export interface MissingEvidence {
  question: string;
  reason: string;
}

/** 建议的下一步动作 */
export interface SuggestedNextAction {
  action: string;
  reason: string;
}

/** Board 摘要（v6 输出用，不含 full BoardNode 详情） */
export interface QueryBoardSummary {
  mode: BoardMode;
  question: string;
  seedCount: number;
  evidenceCount: number;
  relatedCount: number;
  limitCount: number;
  counterCount: number;
  questionCount: number;
  sourceExcerptCount: number;
  gapCount: number;
  seedNodeIds: string[];
}

/** token 用量（v6 标准化） */
export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

/** v6 query 输出（spec 9.1） */
export interface QueryResultV6 {
  ok: boolean;
  mode: BoardMode;
  question: string;
  /** LLM 自由综合的回答（board-only 时为标注） */
  answer: string;
  /** 输出分层：来自 wiki 的内容 */
  fromWiki: WikiClaimRef[];
  /** 输出分层：模型综合 */
  modelSynthesis: ModelSynthesis[];
  /** 输出分层：缺失依据 */
  missingEvidence: MissingEvidence[];
  /** 建议的下一步动作（heuristic） */
  suggestedNextActions: SuggestedNextAction[];
  /** 完整 Board（确定性装配层，含所有 BoardNode 详情） */
  board: QueryBoard;
  /** Board 摘要（轻量版，给日志/调试用） */
  boardSummary: QueryBoardSummary;
  /** token 用量（无 LLM 时为 null） */
  usage: Usage | null;
}

// ─── v6 Query Board ────────────────────────────────────────────────

export interface BoardNode {
  nodeId: string;
  kind: WikiKind;
  title: string;
  filePath: string;
  claim: string;
  evidence: string[];
  interpretation: string;
  limits: string[];
  tags: string[];
  sourceIds: string[];
  sourceChase: string[];
  chunkRefs: number[];
  auditStatus?: AuditStatus;
  auditScore?: number;
  /** v5 节点不要求带 boardRoles；v6 节点应至少含一项。可选以保留 v5 兼容。 */
  boardRoles?: BoardRole[];
  score: number;
}

export interface SourceExcerpt {
  sourceId: string;
  sourceChase: string;
  chunkRefs: number[];
  text: string;
}

export interface BoardGap {
  question: string;
  reason: string;
}

/**
 * 给 LLM 的局面说明（spec 8.1）。
 * 不规定推理路线，只声明当前局面有什么 + 输出要标注哪些边界。
 */
export interface BoardInstruction {
  /** 模式名（v6 BoardMode） */
  mode: BoardMode;
  /** 当前摆出的节点摘要（人类可读） */
  boardSummary: string;
  /** 允许的综合方向（如 "free synthesis" / "strict citation"） */
  synthesisLevel: "free" | "anchored" | "strict";
  /** 输出边界要求 */
  outputBoundaries: {
    /** 是否要求输出 fromWiki / modelSynthesis / missingEvidence 三段 */
    requireLayeredOutput: boolean;
    /** 是否要求每条结论都引用 chunkRef */
    requireChunkRef: boolean;
    /** 是否要求 explicit 标注 wiki / inference 边界 */
    requireEvidenceBoundary: boolean;
  };
  /** 当前局面对用户问题的覆盖评估（human-readable） */
  coverageNote?: string;
}

export interface QueryBoard {
  mode: BoardMode;
  question: string;
  seedNodes: BoardNode[];
  evidenceNodes: BoardNode[];
  relatedNodes: BoardNode[];
  limitNodes: BoardNode[];
  counterNodes: BoardNode[];
  questionNodes: BoardNode[];
  /** 语义失败但有 claim 的节点 — inspire 的张力素材 */
  tensionNodes: BoardNode[];
  sourceExcerpts: SourceExcerpt[];
  gaps: BoardGap[];
  /** spec 8.1 要求的局面说明 */
  instructions: BoardInstruction;
}

export type SemanticVerdict = "aligned" | "stretched" | "unsupported";
export type AuditDimension = "support" | "addition" | "inference" | "limits" | "citation";

export interface SemanticAuditIssue {
  nodeId: string;
  filePath: string;
  severity: "warning" | "error";
  dimension: AuditDimension;
  claim: string;
  evidenceExcerpt: string;
  reason: string;
  suggestedFix?: string;
}

export interface SemanticAuditResult {
  ok: boolean;
  summary: {
    nodes: number;
    passed: number;
    warning: number;
    failed: number;
    averageScore: number;
  };
  issues: SemanticAuditIssue[];
  /** 每个节点的语义审计分数（nodeId → score），用于写回 frontmatter */
  nodeScores?: Record<string, number>;
}

export interface SemanticJudgeVerdict {
  nodeId: string;
  verdict: "passed" | "warning" | "failed";
  score: number;
  support: SemanticVerdict;
  addition: "none" | "minor" | "major";
  inference: "ok" | "warning" | "failed";
  limits: "ok" | "warning" | "failed";
  citation: "ok" | "warning" | "failed";
  issues: string[];
}

// ─── v6 共享解析器类型 ─────────────────────────────────────────────

export interface ParsedWikiNode {
  nodeId: string;
  kind: WikiKind;
  title: string;
  filePath: string;
  frontmatter: WikiFrontmatter;
  sections: {
    claim: string;
    evidence: string[];
    interpretation: string;
    useFor: string[];
    limits: string[];
    links: string[];
    auditNotes: string;
    boardUse: string[];
  };
  fullText: string;
  isLegacy: boolean;
}

export interface SearchMatchV6 {
  nodeId: string;
  kind: WikiKind;
  title: string;
  score: number;
  filePath: string;
  claim: string;
  evidence: string[];
  interpretation: string;
  limits: string[];
  useFor: string[];
  sourceIds: string[];
  sourceChase: string[];
  chunkRefs: number[];
  related: string[];
  tags: string[];
  auditStatus?: AuditStatus;
  auditScore?: number;
}

export interface ChaseChunk {
  index: number;
  text: string;
  marker: string;
}

// ─── Pro 统一输出 ─────────────────────────────────────────────────

export type ProMode = "extract" | "compile" | "reread";

export interface ProResult {
  mode: ProMode;
  materialId: string;
  title: string;
  type: "md" | "pdf" | "tex";
  humanAnchor: { id: string; text: string } | null;

  // extract 输出
  mainThreads?: MainThread[];
  propositions?: Proposition[];

  // compile 输出
  pages?: WikiPage[];
  updatedPages?: WikiPage[];
  nodeDrafts?: WikiNodeDraft[];

  // 所有模式
  hypotheses: HypothesisOption[];
  feedbackText: string;
}

// ─── Config ────────────────────────────────────────────────────────

export interface AppConfig {
  apiKey: string;
  baseUrl: string;
  projectRoot: string;
  rawDir: string;
  wikiDir: string;
  model: string;
  chunkTokenTarget: number;
  chunkOverlapTokens: number;
}

// ─── CLI ───────────────────────────────────────────────────────────

export interface IngestOptions {
  file: string;
  anchor?: string;
  mode?: string;
  auto?: boolean;
  policy?: string;
  json?: boolean;
  dryRun?: boolean;
  noAudit?: boolean;
}
