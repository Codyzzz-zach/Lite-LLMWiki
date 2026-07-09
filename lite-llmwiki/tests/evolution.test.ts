/**
 * evolution — 自进化系统单测
 */
import { describe, expect, it, vi } from "vitest";
import { detectContradictions, contradictionsToEdges } from "../src/evolution/contradiction.js";
import { screenReflowCandidates, reflowToFrontmatter } from "../src/evolution/reflow.js";
import { detectReinforcementCandidates } from "../src/evolution/reinforce.js";
import { parseConfirmManifest, checkBacklog, autoDegrade } from "../src/evolution/confirm.js";
import type { WikiNodeDraft, AppConfig } from "../src/types.js";

function makeDraft(nodeId = "test/concept/x", claim = "quantum computing uses superposition for parallel processing."): WikiNodeDraft {
  return {
    nodeId,
    kind: "concept",
    filePath: `wiki/concepts/${nodeId.replace(/\//g, "-")}.md`,
    frontmatter: { title: "X", kind: "concept" },
    claim,
    evidence: [],
  };
}

// ─── contradiction ─────────────────────────────────────────────────

describe("contradiction", () => {
  it("无相同 kind 节点时返回空", async () => {
    const mockLlm = vi.fn();
    const result = await detectContradictions(
      {} as AppConfig,
      makeDraft("test/concept/new", "A is true"),
      [{ nodeId: "test/method/old", claim: "B is false", kind: "method" }],
      mockLlm,
    );
    expect(result.candidates).toEqual([]);
    expect(mockLlm).not.toHaveBeenCalled();
  });

  it("有相同 kind 节点时调用 LLM", async () => {
    const mockLlm = vi.fn(async () => JSON.stringify([
      { nodeA: "test/concept/new", nodeB: "test/concept/old", reason: "contradiction", confidence: 0.9 },
    ]));
    const result = await detectContradictions(
      {} as AppConfig,
      makeDraft("test/concept/new", "qubits enable superluminal communication"),
      [{ nodeId: "test/concept/old", claim: "entanglement does not enable superluminal communication", kind: "concept" }],
      mockLlm,
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.confidence).toBe(0.9);
  });

  it("contradictionsToEdges 转换正确", () => {
    const edges = contradictionsToEdges([
      { nodeA: "a", nodeB: "b", reason: "conflict", confidence: 0.8 },
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.type).toBe("contradicts");
    expect(edges[0]!.from).toBe("a");
  });
});

// ─── reflow ────────────────────────────────────────────────────────

describe("reflow", () => {
  it("claim 太短被过滤", () => {
    const draft = makeDraft("test/concept/new", "short");
    const candidates = screenReflowCandidates(
      [{ draft, derivedFrom: ["src"], reason: "test", confidence: 0.8 }],
      new Set(),
    );
    expect(candidates).toEqual([]);
  });

  it("重复 nodeId 被过滤", () => {
    const longClaim = "This is a sufficiently long claim text for testing reflow screening logic requirements";
    const candidates = screenReflowCandidates(
      [{ draft: makeDraft("test/concept/x", longClaim), derivedFrom: ["src"], reason: "test", confidence: 0.8 }],
      new Set(["test/concept/x"]),
    );
    expect(candidates).toEqual([]);
  });

  it("通过筛选的候选正常返回", () => {
    const longClaim = "This is a sufficiently long claim text for testing reflow screening logic requirements at least fifty characters";
    const candidates = screenReflowCandidates(
      [{ draft: makeDraft("test/concept/new", longClaim), derivedFrom: ["src"], reason: "test", confidence: 0.8 }],
      new Set(),
    );
    expect(candidates).toHaveLength(1);
  });

  it("reflowToFrontmatter 添加 reflowOrigin 和 derived_from 边", () => {
    const fm = reflowToFrontmatter(
      { draft: makeDraft("test/concept/new", "A long enough claim for reflow testing purposes"), derivedFrom: ["src/a", "src/b"], reason: "test", confidence: 0.7 },
      { title: "New", kind: "concept" },
    );
    expect(fm.reflowOrigin).toBe("src/a,src/b");
    expect(fm.status).toBe("draft");
    expect(fm.edges).toHaveLength(2);
    expect(fm.edges![0]!.type).toBe("derived_from");
  });
});

// ─── reinforce ─────────────────────────────────────────────────────

describe("reinforce", () => {
  const passLlm = async (sys: string, msg: string) => JSON.stringify({ score: 0.85, reason: "test pass" });
  const failLlm = async (sys: string, msg: string) => JSON.stringify({ score: 0.3, reason: "test fail" });

  it("关键词无重叠时返回空（不调 LLM）", async () => {
    const mockLlm = vi.fn(passLlm);
    const result = await detectReinforcementCandidates(
      makeDraft("test/concept/new", "quantum computing superposition parallel"),
      [{ nodeId: "test/concept/old", claim: "classical mechanics newton gravity force", kind: "concept" }],
      mockLlm,
    );
    expect(result).toEqual([]);
    expect(mockLlm).not.toHaveBeenCalled(); // 预筛不通过，不应调 LLM
  });

  it("预筛通过但语义不一致 → 不标记候选", async () => {
    const mockLlm = vi.fn(failLlm);
    const result = await detectReinforcementCandidates(
      makeDraft("test/concept/new", "quantum computing superposition parallel processing"),
      [{ nodeId: "test/concept/old", claim: "quantum computer superposition parallel operation speed", kind: "concept" }],
      mockLlm,
    );
    expect(result).toEqual([]);
    expect(mockLlm).toHaveBeenCalled(); // 预筛通过，调了 LLM
  });

  it("预筛通过且双维度通过 → 标记候选", async () => {
    const mockLlm = vi.fn(passLlm);
    const result = await detectReinforcementCandidates(
      makeDraft("test/concept/new", "quantum computing superposition parallel processing"),
      [{ nodeId: "test/concept/old", claim: "quantum computer superposition parallel operation speed", kind: "concept" }],
      mockLlm,
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.existingNodeId).toBe("test/concept/old");
    expect(result[0]!.semanticConsistency).toBe(0.85);
    expect(result[0]!.evidenceIncrement).toBe(0.85);
  });

  it("不同 kind 之间不检测强化", async () => {
    const mockLlm = vi.fn(passLlm);
    const result = await detectReinforcementCandidates(
      makeDraft("test/concept/new", "quantum computing superposition"),
      [{ nodeId: "test/method/old", claim: "quantum computing superposition", kind: "method" }],
      mockLlm,
    );
    expect(result).toEqual([]);
  });
});

// ─── confirm ───────────────────────────────────────────────────────

describe("confirm", () => {
  it("parseConfirmManifest 解析待确认清单", () => {
    const content = `## 待确认
- [ ] [high] supersede: node A replaced by node B
- [x] [medium] edge: add derived_from edge
- [ ] [low] reflow: reflow candidate node C
`;
    const manifest = parseConfirmManifest(content);
    expect(manifest.items).toHaveLength(3);
    expect(manifest.backlog).toBe(2);
  });

  it("checkBacklog 正常/警告/降级", () => {
    expect(checkBacklog({ items: [], lastProcessedAt: null, backlog: 5 }).level).toBe("normal");
    expect(checkBacklog({ items: [], lastProcessedAt: null, backlog: 25 }).level).toBe("warning");
    expect(checkBacklog({ items: [], lastProcessedAt: null, backlog: 55 }).level).toBe("degraded");
  });

  it("autoDegrade 移除低优先项", () => {
    const manifest = {
      items: [
        { id: "1", type: "reflow" as const, priority: "low" as const, summary: "low", createdAt: "", status: "pending" as const },
        { id: "2", type: "edge" as const, priority: "high" as const, summary: "high", createdAt: "", status: "pending" as const },
      ],
      lastProcessedAt: null,
      backlog: 2,
    };
    const result = autoDegrade(manifest);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.priority).toBe("high");
  });
});
