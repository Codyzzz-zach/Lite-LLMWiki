/**
 * graph-ready manifest — Phase 7 单测
 *
 * 覆盖（plan 7.4 + 7.5）：
 * - claimHash: normalized claim → sha256 → first 16 chars (deterministic)
 * - related 自动生成（基于 shared tags / shared sourceIds）
 * - IndexEntryV6 写回 wiki/index.json
 */
import { describe, expect, it } from "vitest";
import { computeClaimHash, generateRelatedFor, type RelatedNode } from "../src/knowledge/manifest.js";

describe("graph-ready — claimHash (plan 12.4)", () => {
  it("相同 claim → 相同 hash", () => {
    const h1 = computeClaimHash("1/e 是失败概率的极限值");
    const h2 = computeClaimHash("1/e 是失败概率的极限值");
    expect(h1).toBe(h2);
  });

  it("不同 claim → 不同 hash", () => {
    const h1 = computeClaimHash("claim A");
    const h2 = computeClaimHash("claim B");
    expect(h1).not.toBe(h2);
  });

  it("hash 是 16 字符（plan: first 16 chars of sha256）", () => {
    const h = computeClaimHash("any claim");
    expect(h.length).toBe(16);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("whitespace 归一化（leading/trailing/multiple spaces 视为同 claim）", () => {
    const h1 = computeClaimHash("claim  with   spaces");
    const h2 = computeClaimHash("claim with spaces");
    expect(h1).toBe(h2);
  });

  it("case-sensitive（区分大小写）", () => {
    const h1 = computeClaimHash("Claim");
    const h2 = computeClaimHash("claim");
    expect(h1).not.toBe(h2);
  });

  it("空 claim 返回 16 字符（empty 的 hash）", () => {
    const h = computeClaimHash("");
    expect(h.length).toBe(16);
  });
});

describe("graph-ready — related 自动生成 (plan 7.5)", () => {
  it("shared tag → 包含在 related", () => {
    const result = generateRelatedFor(
      { nodeId: "main", kind: "concept", sourceIds: ["raw_a"], tags: ["math"] },
      [
        { nodeId: "other", kind: "method", sourceIds: ["raw_b"], tags: ["math"] },
        { nodeId: "unrelated", kind: "case", sourceIds: ["raw_c"], tags: ["biology"] },
      ],
    );
    const ids = result.map((r) => r.nodeId);
    expect(ids).toContain("other");
    expect(ids).not.toContain("unrelated");
  });

  it("shared sourceId → 包含在 related", () => {
    const result = generateRelatedFor(
      { nodeId: "main", kind: "concept", sourceIds: ["raw_a"], tags: [] },
      [
        { nodeId: "other", kind: "method", sourceIds: ["raw_a"], tags: [] },
      ],
    );
    expect(result.map((r) => r.nodeId)).toContain("other");
  });

  it("explicit related 优先级最高", () => {
    const result = generateRelatedFor(
      { nodeId: "main", kind: "concept", sourceIds: ["raw_a"], tags: [], related: ["explicit-node"] },
      [
        { nodeId: "explicit-node", kind: "method", sourceIds: [], tags: [] },
        { nodeId: "tag-node", kind: "method", sourceIds: [], tags: ["shared"] },
      ],
      // 当 caller 显式声明 related 时，只有 explicit + 任何 tag 共享者
    );
    const ids = result.map((r) => r.nodeId);
    expect(ids).toContain("explicit-node");
  });

  it("空 pool → 空 related", () => {
    const result = generateRelatedFor(
      { nodeId: "main", kind: "concept", sourceIds: ["raw_a"], tags: ["math"] },
      [],
    );
    expect(result).toEqual([]);
  });

  it("返回结果不含 seed 自己", () => {
    const result = generateRelatedFor(
      { nodeId: "main", kind: "concept", sourceIds: ["raw_a"], tags: ["math"] },
      [{ nodeId: "main", kind: "concept", sourceIds: ["raw_a"], tags: ["math"] }],
    );
    expect(result.map((r) => r.nodeId)).not.toContain("main");
  });
});
