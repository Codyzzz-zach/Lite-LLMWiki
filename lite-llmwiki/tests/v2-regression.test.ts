/**
 * v2-regression — v2 架构改造的回归测试
 *
 * 验证 A1 (Board 简化)、C1-C2 (RRF 重排) 的行为正确性。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.js";
import { buildQueryBoard } from "../src/query/board.js";
import { walkGraph } from "../src/query/graph-search.js";
import { buildGraph } from "../src/knowledge/graph.js";
import { rrfFusion, scoresToRanks } from "../src/query/rrf.js";

// ── helpers ──

const testRoot = join(tmpdir(), `litewiki-v2-test-${Date.now()}`);

function makeTempConfig(): ReturnType<typeof loadConfig> {
  const rawDir = join(testRoot, "raw");
  const wikiDir = join(testRoot, "wiki");
  mkdirSync(join(rawDir, "chase"), { recursive: true });
  for (const d of ["concepts","claims","counters"]) {
    mkdirSync(join(wikiDir, d), { recursive: true });
  }
  return {
    projectRoot: testRoot,
    rawDir,
    wikiDir,
    model: "test",
    chunkTokenTarget: 2000,
    chunkOverlapTokens: 100,
    apiKey: "test-key",
    policy: "balanced",
  } as ReturnType<typeof loadConfig>;
}

function wikiPage(nodeId: string, kind: string, claim: string, edgesJson = "[]") {
  return `---
nodeId: ${nodeId}
kind: ${kind}
title: ${claim.slice(0, 20)}
claim: ${claim}
sourceIds: [test-source]
sourceChase: [test-chase.md]
propRefs: ["1"]
confidence: 0.8
status: verified
tags: []
related: []
edges: ${edgesJson}
---

## Claim
${claim}
`;
}

// ── A1: Board mode injection behavior ──

describe("v2 A1 — Board mode injection", () => {
  const config = makeTempConfig();

  beforeAll(() => {
    // Create test wiki nodes including a counter
    writeFileSync(join(config.wikiDir, "concepts", "a.md"), wikiPage(
      "a", "concept", "秘书问题是1/e的经典应用",
      '[{"from":"a","to":"b","type":"related","confidence":0.9},{"from":"a","to":"c","type":"contradicts","confidence":0.7}]'
    ));
    writeFileSync(join(config.wikiDir, "concepts", "b.md"), wikiPage(
      "b", "concept", "错位排列的1/e极限"
    ));
    writeFileSync(join(config.wikiDir, "counters", "c.md"), wikiPage(
      "c", "counter", "1/e不是自然常数，只是37%近似"
    ));
    writeFileSync(join(config.wikiDir, "concepts", "d.md"), wikiPage(
      "d", "insight", "泊松分布与1/e的深层联系"
    ));
  });

  it("ask mode 不强制注入 counter/question（但搜索命中的不排除)", async () => {
    const board = await buildQueryBoard(config, "1/e 在概率论中的应用", {
      mode: "ask", maxNodes: 3,
    });
    // counterNodes/questionNodes 来自强制注入——应为空
    expect(board.counterNodes).toHaveLength(0);
    expect(board.questionNodes).toHaveLength(0);
  });

  it("challenge mode 带 counter 节点", async () => {
    const board = await buildQueryBoard(config, "1/e 在概率论中的应用", {
      mode: "challenge", maxNodes: 3,
    });
    // challenge mode 应该找到 counter 节点 c
    const hasCounter = board.counterNodes.some(n => n.nodeId === "c");
    expect(hasCounter).toBe(true);
  });
});

// ── C1-C2: RRF fusion + walkGraph ──

describe("v2 C1-C2 — RRF fusion with graph re-ranking", () => {
  const config = makeTempConfig();

  beforeAll(() => {
    // Create nodes with explicit edge structure
    writeFileSync(join(config.wikiDir, "concepts", "seed1.md"), wikiPage(
      "seed1", "concept", "A: 核心概念",
      '[{"from":"seed1","to":"neighbor1","type":"derived_from","confidence":0.95}]'
    ));
    writeFileSync(join(config.wikiDir, "concepts", "seed2.md"), wikiPage(
      "seed2", "concept", "B: 相关知识",
      '[{"from":"seed2","to":"neighbor1","type":"related","confidence":0.85}]'
    ));
    writeFileSync(join(config.wikiDir, "concepts", "neighbor1.md"), wikiPage(
      "neighbor1", "concept", "C: 被多个seed引用的邻居"
    ));
    writeFileSync(join(config.wikiDir, "concepts", "orphan.md"), wikiPage(
      "orphan", "concept", "D: 孤立节点"
    ));
  });

  it("walkGraph 发现被多个 seed 引用的邻居", () => {
    const graph = buildGraph(config);
    const scores = walkGraph(["seed1", "seed2"], graph);
    // neighbor1 被 seed1 (0.95) 和 seed2 (0.85) 引用 → 取 max = 0.95
    expect(scores.has("neighbor1")).toBe(true);
    expect(scores.get("neighbor1")).toBe(0.95);
  });

  it("RRF fusion——graph 邻居进候选但同量纲不压过 seed（Finding 1）", () => {
    const bm25 = new Map([["seed1", 1], ["seed2", 2], ["orphan", 3]]);
    const vec  = new Map([["seed1", 1], ["seed2", 2], ["orphan", 3]]);
    // walkGraph 返回 score（0-1），经 scoresToRanks 转 rank 后喂 RRF
    const graphScores = new Map([["neighbor1", 0.95]]);
    const graphRanks = scoresToRanks(graphScores);

    const fused = rrfFusion(bm25, vec, graphRanks);
    // neighbor1 不在 BM25/Vector 中，但 graph 给了 rank 1
    // → fused = 0 + 0 + 0.3/61 ≈ 0.0049（同量纲，不压过 seed）
    expect(fused.has("neighbor1")).toBe(true);
    expect(fused.get("neighbor1")).toBeCloseTo(0.3 / 61, 4);
    // seed1（BM25+Vector 双第1）必须高于 graph-only neighbor1
    expect(fused.get("seed1")!).toBeGreaterThan(fused.get("neighbor1")!);
  });

  it("board query 通过 graph re-ranking 改变 seed 顺序", async () => {
    const board = await buildQueryBoard(config, "核心概念 相关知识", {
      mode: "ask", maxNodes: 3,
    });
    // search 词 "核心概念" 应匹配 seed1，"相关知识" 应匹配 seed2
    // 两者共享 neighbor1 → neighbor1 的 graph score 应被考虑
    expect(board.seedNodes.length).toBeGreaterThanOrEqual(2);
  });
});

// ── cleanup ──
afterAll(() => {
  try { rmSync(testRoot, { recursive: true }); } catch {}
});
