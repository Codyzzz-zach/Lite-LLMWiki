/**
 * policy.ts — 自动确认策略
 *
 * 三档 policy 控制 ingest --auto 模式下哪些 proposition 自动确认：
 *
 * | policy      | 行为                                                       |
 * |-------------|------------------------------------------------------------|
 * | conservative | 只确认 high confidence (≥0.7) + evidence 完整的 core 类型  |
 * | balanced     | high/medium (≥0.4) 均可确认，question/insight 需 evidence |
 * | expansive    | 允许 insight/counter/question，但必须标注 limits           |
 */

import type { Evidence, WikiKind } from "../types.js";

// ─── 类型 ────────────────────────────────────────────────────────────────

export type Policy = "conservative" | "balanced" | "expansive";

export interface PolicyInput {
  kind?: WikiKind;
  confidence?: number;
  evidence?: Evidence[];
  limits?: string[];
}

export interface PolicyResult {
  accept: boolean;
  reason?: string;
}

// ─── 常量 ────────────────────────────────────────────────────────────────

/** high confidence 下限 */
const HIGH_CONF = 0.7;
/** medium confidence 下限 */
const MED_CONF = 0.4;

/** conservative 和 balanced 偏「事实」的类型，自动确认门槛低 */
const FACT_KINDS: ReadonlySet<WikiKind> = new Set([
  "concept",
  "claim",
  "method",
  "case",
  "equation",
]);

/** balanced 下需要 evidence 才放行的「软」类型 */
const SOFT_KINDS: ReadonlySet<WikiKind> = new Set(["question", "insight"]);

/** expansive 下要求标注 limits 的类型 */
const LIMITS_REQUIRED_KINDS: ReadonlySet<WikiKind> = new Set([
  "insight",
  "counter",
  "question",
]);

// ─── 核心 ────────────────────────────────────────────────────────────────

/**
 * 按 policy 规则判定是否自动确认一条 proposition。
 *
 * @param policy 策略档位
 * @param input  proposition 的关键字段
 * @returns { accept, reason? } — accept=true 表示自动确认
 */
export function filterByPolicy(policy: Policy, input: PolicyInput): PolicyResult {
  const { kind, confidence, evidence, limits } = input;

  // ——— 缺失 confidence → 保守拒绝 ———
  if (confidence === undefined || confidence === null) {
    return { accept: false, reason: "Missing confidence" };
  }

  // ——— 所有 policy 都拒绝 low confidence ———
  if (confidence < MED_CONF) {
    return { accept: false, reason: `Low confidence (${confidence.toFixed(2)})` };
  }

  switch (policy) {
    // ── conservative ──────────────────────────────────────────────
    case "conservative": {
      // 只有 fact kinds 才允许
      if (!kind || !FACT_KINDS.has(kind)) {
        return { accept: false, reason: `Conservative: kind "${kind ?? "undefined"}" not in fact types` };
      }
      // 必须 high confidence
      if (confidence < HIGH_CONF) {
        return { accept: false, reason: `Conservative: confidence ${confidence.toFixed(2)} < ${HIGH_CONF}` };
      }
      // 必须 evidence 完整
      if (!evidence || evidence.length === 0) {
        return { accept: false, reason: "Conservative: no evidence" };
      }
      return { accept: true };
    }

    // ── balanced ──────────────────────────────────────────────────
    case "balanced": {
      // fact kinds: high/medium 都 accept
      if (kind && FACT_KINDS.has(kind)) {
        return { accept: true };
      }
      // soft kinds: 需要 evidence
      if (kind && SOFT_KINDS.has(kind)) {
        if (!evidence || evidence.length === 0) {
          return { accept: false, reason: `Balanced: "${kind}" needs evidence` };
        }
        return { accept: true };
      }
      // counter / anchor / undefined: 保守拒绝
      return { accept: false, reason: `Balanced: kind "${kind ?? "undefined"}" not auto-confirmable` };
    }

    // ── expansive ─────────────────────────────────────────────────
    case "expansive": {
      // insight/counter/question 必须标注 limits
      if (kind && LIMITS_REQUIRED_KINDS.has(kind)) {
        if (!limits || limits.length === 0) {
          return { accept: false, reason: `Expansive: "${kind}" must have limits` };
        }
        return { accept: true };
      }
      // 其余类型: high/medium 都 accept（最低 confidence 已在上层过滤）
      return { accept: true };
    }

    default:
      return { accept: false, reason: `Unknown policy: ${policy}` };
  }
}

// ─── 工具 ────────────────────────────────────────────────────────────────

const POLICY_NAMES: Record<Policy, string> = {
  conservative: "保守 — 只确认 high confidence + 完整 evidence 的事实类型",
  balanced: "均衡 — high/medium 均可，question/insight 需 evidence",
  expansive: "扩展 — 允许 insight/counter/question，但必须有 limits",
};

/** 返回人可读的策略说明 */
export function describePolicy(policy: Policy): string {
  return POLICY_NAMES[policy];
}
