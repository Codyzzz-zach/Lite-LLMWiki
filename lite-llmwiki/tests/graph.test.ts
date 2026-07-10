/**
 * graph — 图谱系统单测
 *
 * 覆盖：
 * - buildGraph: 从 wiki 目录重建图谱
 * - getOutgoingEdges / getIncomingEdges / getRelatedEdges / getEdgesByType
 * - findOrphanNodes / findContradictions / getGraphStats
 * - 边界：空 wiki、无 edge 的节点、重复边去重
 *
 * 注意：edges 字段因 YAML 解析器限制，以 JSON 字符串形式存入 frontmatter。
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/types.js";
import {
  buildGraph,
  getOutgoingEdges,
  getIncomingEdges,
  getRelatedEdges,
  getEdgesByType,
  findOrphanNodes,
  findContradictions,
  getGraphStats,
} from "../src/knowledge/graph.js";

let tmpDir: string;
let config: AppConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "graph-test-"));
  config = {
    rawDir: tmpDir,
    wikiDir: join(tmpDir, "wiki"),
    rootDir: tmpDir,
  } as AppConfig;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function j(v: unknown): string {
  return JSON.stringify(v);
}

function saveNode(dir: string, file: string, nodeId: string, extra: Record<string, string> = {}) {
  const dirPath = join(config.wikiDir, dir);
  mkdirSync(dirPath, { recursive: true });
  const lines = ["---"];
  lines.push(`nodeId: ${nodeId}`);
  lines.push(`kind: concept`);
  lines.push(`title: ${nodeId.split("/").pop() ?? "X"}`);
  for (const [k, v] of Object.entries(extra)) {
    lines.push(`${k}: ${v}`);
  }
  lines.push("---");
  lines.push("## Claim");
  lines.push("Test.");
  writeFileSync(join(dirPath, file), lines.join("\n") + "\n", "utf-8");
}

describe("buildGraph", () => {
  it("空 wiki 返回空图谱", () => {
    mkdirSync(join(config.wikiDir, "concepts"), { recursive: true });
    const graph = buildGraph(config);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it("单个节点无 edge 时正常返回", () => {
    saveNode("concepts", "alpha.md", "test/concept/alpha");
    const graph = buildGraph(config);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]!.nodeId).toBe("test/concept/alpha");
    expect(graph.edges).toEqual([]);
  });

  it("有 edge 的节点正确收集边（JSON 格式）", () => {
    saveNode("concepts", "a.md", "test/concept/a", {
      edges: j([{ from: "test/concept/a", to: "test/concept/b", type: "derived_from", confidence: 0.9 }]),
    });
    saveNode("concepts", "b.md", "test/concept/b");

    const graph = buildGraph(config);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]!.from).toBe("test/concept/a");
    expect(graph.edges[0]!.to).toBe("test/concept/b");
    expect(graph.edges[0]!.type).toBe("derived_from");
    expect(graph.edges[0]!.confidence).toBe(0.9);
  });

  it("重复边去重（保留高 confidence）", () => {
    saveNode("concepts", "a.md", "test/concept/a", {
      edges: j([{ from: "test/concept/a", to: "test/concept/b", type: "supports", confidence: 0.5 }]),
    });
    saveNode("concepts", "c.md", "test/concept/c", {
      edges: j([{ from: "test/concept/a", to: "test/concept/b", type: "supports", confidence: 0.9 }]),
    });

    const graph = buildGraph(config);
    const supports = graph.edges.filter((e) => e.type === "supports");
    expect(supports).toHaveLength(1);
    expect(supports[0]!.confidence).toBe(0.9);
  });
});

describe("edge queries", () => {
  beforeEach(() => {
    saveNode("concepts", "a.md", "test/concept/a", {
      edges: j([
        { from: "test/concept/a", to: "test/concept/b", type: "derived_from" },
        { from: "test/concept/a", to: "test/concept/c", type: "contradicts" },
      ]),
    });
    saveNode("concepts", "b.md", "test/concept/b");
    saveNode("concepts", "c.md", "test/concept/c");
  });

  it("getOutgoingEdges 返回出边", () => {
    const graph = buildGraph(config);
    const outgoing = getOutgoingEdges(graph, "test/concept/a");
    expect(outgoing).toHaveLength(2);
    expect(outgoing.every((e) => e.from === "test/concept/a")).toBe(true);
  });

  it("getIncomingEdges 返回入边", () => {
    const graph = buildGraph(config);
    const incoming = getIncomingEdges(graph, "test/concept/b");
    expect(incoming).toHaveLength(1);
    expect(incoming[0]!.from).toBe("test/concept/a");
  });

  it("getEdgesByType 按类型筛选", () => {
    const graph = buildGraph(config);
    const contradicts = getEdgesByType(graph, "contradicts");
    expect(contradicts).toHaveLength(1);
    expect(contradicts[0]!.to).toBe("test/concept/c");
  });
});

describe("graph health", () => {
  it("findOrphanNodes 检测真正孤立节点", () => {
    saveNode("concepts", "a.md", "test/concept/a");
    saveNode("concepts", "b.md", "test/concept/b");

    const graph = buildGraph(config);
    const orphans = findOrphanNodes(graph);
    expect(orphans).toHaveLength(2);
  });

  it("有边连接时不产生孤立节点", () => {
    saveNode("concepts", "a.md", "test/concept/a", {
      edges: j([{ from: "test/concept/a", to: "test/concept/b", type: "related" }]),
    });
    saveNode("concepts", "b.md", "test/concept/b");

    const graph = buildGraph(config);
    const orphans = findOrphanNodes(graph);
    expect(orphans).toHaveLength(0);
  });

  it("findContradictions 检测矛盾边", () => {
    saveNode("concepts", "a.md", "test/concept/a", {
      edges: j([{ from: "test/concept/a", to: "test/concept/b", type: "contradicts", confidence: 0.7 }]),
    });
    saveNode("concepts", "b.md", "test/concept/b");

    const graph = buildGraph(config);
    const contradictions = findContradictions(graph);
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0]!.type).toBe("contradicts");
  });

  it("getGraphStats 生成完整统计", () => {
    saveNode("concepts", "a.md", "test/concept/a", {
      edges: j([{ from: "test/concept/a", to: "test/concept/b", type: "contradicts" }]),
    });
    saveNode("concepts", "b.md", "test/concept/b");
    saveNode("concepts", "c.md", "test/concept/c");

    const graph = buildGraph(config);
    const stats = getGraphStats(graph);

    expect(stats.totalNodes).toBe(3);
    expect(stats.totalEdges).toBe(1);
    expect(stats.orphanCount).toBe(1);
    expect(stats.orphanRate).toBe(33);
    expect(stats.contradictionCount).toBe(1);
    expect(stats.edgeTypeBreakdown["contradicts"]).toBe(1);
  });
});
