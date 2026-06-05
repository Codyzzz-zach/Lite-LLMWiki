/**
 * agent contract — 标准化的 failure JSON（spec 11.3）
 *
 * 所有核心命令在 failure 时必须返回该 shape：
 * ```json
 * {
 *   "ok": false,
 *   "stage": "<plan|ingest|audit|semantic-audit|query|inspire>",
 *   "error": "<错误信息>",
 *   "blockingIssues": ["..."],
 *   "suggestedNextActions": ["..."]
 * }
 * ```
 */
export type AgentStage =
  | "plan"
  | "ingest"
  | "audit"
  | "semantic-audit"
  | "query"
  | "inspire"
  | "unknown";

export interface AgentFailure {
  ok: false;
  stage: AgentStage;
  error: string;
  blockingIssues: string[];
  suggestedNextActions: string[];
}

export interface BuildFailureOptions {
  stage: AgentStage | string;
  error: string;
  blockingIssues?: string[];
  suggestedNextActions?: string[];
}

export function buildFailureJson(opts: BuildFailureOptions): AgentFailure {
  return {
    ok: false,
    stage: (opts.stage as AgentStage) || "unknown",
    error: opts.error,
    blockingIssues: opts.blockingIssues ?? [],
    suggestedNextActions: opts.suggestedNextActions ?? [],
  };
}
