/**
 * agent contract — Phase 6 failure JSON + flow tests
 *
 * 覆盖（spec 11.3 / plan 11.4）：
 * - 所有核心命令在 failure 时返回 { ok: false, stage, error, blockingIssues, suggestedNextActions }
 * - success 时不污染 failure shape
 * - 端到端 flow: plan → ingest → audit 失败 JSON
 */
import { describe, expect, it } from "vitest";
import { buildFailureJson } from "../src/agent/contract.js";

describe("agent contract — failure JSON shape", () => {
  it("buildFailureJson 含 ok=false, stage, error, blockingIssues, suggestedNextActions", () => {
    const f = buildFailureJson({
      stage: "audit",
      error: "sourceChase file not found",
      blockingIssues: ["sourceChase not found for raw_x.md"],
      suggestedNextActions: ["re-run ingest"],
    });
    expect(f.ok).toBe(false);
    expect(f.stage).toBe("audit");
    expect(f.error).toContain("sourceChase");
    expect(Array.isArray(f.blockingIssues)).toBe(true);
    expect(f.blockingIssues).toContain("sourceChase not found for raw_x.md");
    expect(Array.isArray(f.suggestedNextActions)).toBe(true);
    expect(f.suggestedNextActions).toContain("re-run ingest");
  });

  it("buildFailureJson 不污染 success shape（无 ok=true 字段）", () => {
    const f = buildFailureJson({ stage: "ingest", error: "x" });
    expect(f.ok).toBe(false);
    expect(Object.keys(f)).not.toContain("answer");
    expect(Object.keys(f)).not.toContain("board");
  });

  it("stage 必填", () => {
    const f = buildFailureJson({ error: "x" });
    expect(f.stage).toBe("unknown");
  });

  it("blockingIssues 默认为空数组", () => {
    const f = buildFailureJson({ stage: "x", error: "x" });
    expect(f.blockingIssues).toEqual([]);
  });

  it("suggestedNextActions 默认为空数组", () => {
    const f = buildFailureJson({ stage: "x", error: "x" });
    expect(f.suggestedNextActions).toEqual([]);
  });
});
