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

/** 覆盖记录：跟踪 proposition 已被哪些 wiki 页面覆盖 */
export interface CoverageItem {
  /** proposition 编号 */
  propId: number;
  /** 覆盖到的 wiki 页面 filePath */
  coveredIn: string;
  /** 覆盖日期 */
  coveredAt: Date;
}

/** wiki 页面 frontmatter 结构化类型 */
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
  /** --auto: 非交互自动确认 */
  auto?: boolean;
  /** --policy: conservative | balanced | expansive (默认 balanced) */
  policy?: string;
  /** --json: 输出结构化 JSON 到 stdout */
  json?: boolean;
  /** --dry-run: 不写 wiki，只输出报告 */
  dryRun?: boolean;
}
