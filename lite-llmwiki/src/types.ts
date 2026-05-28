/**
 * lite-llmwiki 核心类型定义
 *
 * 三模式：brainstorm（初读 → 主线 + proposition）
 *         reread（单条 proposition 按新角度重读）
 *         compile（已确认 proposition → wiki pages）
 */

// ─── Source（原始材料） ────────────────────────────────────────────

export interface Source {
  id: string;
  path: string;
  type: "md" | "pdf";
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

// ─── Phase 1: Brainstorm 主线 ─────────────────────────────────────

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

export interface WikiPage {
  nodeId: string;
  filePath: string;
  frontmatter: Record<string, unknown>;
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

export type ProMode = "brainstorm" | "compile" | "reread";

export interface ProResult {
  mode: ProMode;
  materialId: string;
  title: string;
  type: "md" | "pdf";
  humanAnchor: { id: string; text: string } | null;

  // brainstorm 输出
  mainThreads?: MainThread[];
  propositions?: Proposition[];

  // compile 输出
  pages?: WikiPage[];
  updatedPages?: WikiPage[];

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
}
