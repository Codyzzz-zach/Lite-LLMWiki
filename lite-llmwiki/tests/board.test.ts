/**
 * board — Query Board Builder 单测
 *
 * 覆盖（plan 8.6 各 mode 装配规则 + 8.8 验收）：
 * - `ask` mode: top relevant + minimal extras
 * - `trace` mode: 含 chase excerpts
 * - `expand` mode: 包含 related / question / anchor nodes
 * - `compare` mode: 多组 seedNodes（每组一个 source）
 * - `challenge` mode: 包含 limit / counter nodes
 * - alias 归一化 (exact→trace, explore→expand, counter→challenge)
 * - mode 缺省回退到 ask
 * - `instructions` 字段正确填充
 * - `gaps` 在无匹配时填充
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppConfig, BoardMode } from "../src/types.js";
import { renderWikiNode } from "../src/knowledge/render.js";
import { buildQueryBoard } from "../src/query/board.js";
import type { WikiNodeDraft } from "../src/types.js";

let tmpDir: string;
let config: AppConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "board-test-"));
  config = {
    rawDir: tmpDir,
    wikiDir: join(tmpDir, "wiki"),
    rootDir: tmpDir,
  } as AppConfig;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function saveDraft(draft: WikiNodeDraft) {
  const relPath = draft.filePath.startsWith("wiki/") ? draft.filePath.slice(5) : draft.filePath;
  const fullPath = join(config.wikiDir, relPath);
  require("node:fs").mkdirSync(require("node:path").dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, renderWikiNode(draft), "utf-8");
}

function setupChase(content: string) {
  const dir = join(config.rawDir, "chase");
  require("node:fs").mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "raw_x-abcd.md"), content, "utf-8");
}

function makeDraft(overrides: Partial<WikiNodeDraft> = {}): WikiNodeDraft {
  return {
    nodeId: "test/concept/x",
    kind: "concept",
    filePath: "wiki/concepts/test-x.md",
    frontmatter: {
      title: "X",
      nodeId: "test/concept/x",
      kind: "concept",
      sourceIds: ["raw_x-abcd"],
      sourceChase: ["raw/chase/raw_x-abcd.md"],
      chunkRefs: [1],
      confidence: 0.8,
      status: "verified",
      tags: ["x-tag"],
      related: [],
    },
    claim: "claim about 1/e",
    evidence: [{ sourceId: "raw_x-abcd", chunkRefs: [1], summary: "sum" }],
    interpretation: "interpretation",
    limits: ["only in lab"],
    useFor: ["use1"],
    ...overrides,
  };
}

describe("board — 基本结构", () => {
  it("返回 QueryBoard shape", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const board = await buildQueryBoard(config, "what is 1/e?", { mode: "ask" });
    expect(board.mode).toBe("ask");
    expect(board.question).toBe("what is 1/e?");
    expect(board).toHaveProperty("seedNodes");
    expect(board).toHaveProperty("evidenceNodes");
    expect(board).toHaveProperty("relatedNodes");
    expect(board).toHaveProperty("limitNodes");
    expect(board).toHaveProperty("counterNodes");
    expect(board).toHaveProperty("questionNodes");
    expect(board).toHaveProperty("sourceExcerpts");
    expect(board).toHaveProperty("gaps");
    expect(board).toHaveProperty("instructions");
  });

  it("空 wiki 库返回空 board + instructions 标注", async () => {
    const board = await buildQueryBoard(config, "anything", { mode: "ask" });
    expect(board.seedNodes).toEqual([]);
    expect(board.evidenceNodes).toEqual([]);
    expect(board.relatedNodes).toEqual([]);
    expect(board.gaps.length).toBeGreaterThan(0);
    expect(board.gaps[0]?.question).toBe("anything");
    expect(board.instructions.coverageNote).toMatch(/no.*wiki|empty/i);
  });
});

describe("board — ask mode", () => {
  it("ask mode 召回搜索相关 nodes 作为 seedNodes", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const board = await buildQueryBoard(config, "1/e", { mode: "ask", maxNodes: 5 });
    expect(board.seedNodes.length).toBeGreaterThan(0);
    const seed = board.seedNodes[0]!;
    expect(seed.nodeId).toBe("test/concept/x");
    expect(seed.claim).toContain("1/e");
    expect(seed.score).toBeGreaterThan(0);
  });

  it("ask mode 不读 chase excerpts（最小化）", async () => {
    setupChase("<!-- chunk 1 -->\nA\n<!-- chunk 2 -->\nB\n");
    saveDraft(makeDraft());
    const board = await buildQueryBoard(config, "1/e", { mode: "ask" });
    expect(board.sourceExcerpts).toEqual([]);
  });

  it("ask mode instructions: synthesisLevel='anchored', requireLayeredOutput=true", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const board = await buildQueryBoard(config, "1/e", { mode: "ask" });
    expect(board.instructions.synthesisLevel).toBe("anchored");
    expect(board.instructions.outputBoundaries.requireLayeredOutput).toBe(true);
  });
});

describe("board — trace mode", () => {
  it("trace mode 召回 seedNodes", async () => {
    setupChase("<!-- chunk 1 -->\nOriginal text.\n");
    saveDraft(makeDraft());
    const board = await buildQueryBoard(config, "1/e", { mode: "trace" });
    expect(board.seedNodes.length).toBeGreaterThan(0);
  });

  it("trace mode 默认 withSource=true 时读 chase excerpts", async () => {
    setupChase("<!-- chunk 1 -->\nOriginal text for trace.\n");
    saveDraft(makeDraft());
    const board = await buildQueryBoard(config, "1/e", { mode: "trace" });
    expect(board.sourceExcerpts.length).toBeGreaterThan(0);
    expect(board.sourceExcerpts[0]?.text).toContain("Original text for trace");
  });

  it("trace mode instructions: requireChunkRef=true, synthesisLevel='strict'", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const board = await buildQueryBoard(config, "1/e", { mode: "trace" });
    expect(board.instructions.outputBoundaries.requireChunkRef).toBe(true);
    expect(board.instructions.synthesisLevel).toBe("strict");
  });
});

describe("board — expand mode", () => {
  it("expand mode 包含 relatedNodes（按 tag 共享）", async () => {
    setupChase("<!-- chunk 1 -->\nA\n", "raw_x");
    setupChase("<!-- chunk 1 -->\nB\n", "raw_y");
    // 主 node (claim 含 "1/e" 关键词)
    saveDraft(makeDraft({
      nodeId: "test/concept/main",
      filePath: "wiki/concepts/main.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/main",
        sourceIds: ["raw_x"],
        sourceChase: ["raw/chase/raw_x.md"],
        title: "main",
        tags: ["shared"],
      },
      claim: "claim about 1/e probability",
    }));
    // 共享 tag 的 method (claim 不含 "1/e" 关键词)
    saveDraft(makeDraft({
      nodeId: "test/method/related",
      kind: "method",
      filePath: "wiki/methods/related.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/method/related",
        kind: "method",
        sourceIds: ["raw_y"],
        sourceChase: ["raw/chase/raw_y.md"],
        title: "related",
        tags: ["shared"],
      },
      claim: "a method unrelated to exponential decay",
    }));
    // search "1/e" 只匹配 main，不匹配 method
    const board = await buildQueryBoard(config, "1/e", { mode: "expand" });
    expect(board.seedNodes.some((n) => n.nodeId === "test/concept/main")).toBe(true);
    expect(board.seedNodes.some((n) => n.nodeId === "test/method/related")).toBe(false);
    expect(board.relatedNodes.some((n) => n.nodeId === "test/method/related")).toBe(true);
  });

  it("expand mode instructions: synthesisLevel='free'", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const board = await buildQueryBoard(config, "1/e", { mode: "expand" });
    expect(board.instructions.synthesisLevel).toBe("free");
  });
});

describe("board — compare mode", () => {
  it("compare mode 形成多组 seedNodes（按 source 分组）", async () => {
    setupChase("<!-- chunk 1 -->\nA\n", "raw_a");
    setupChase("<!-- chunk 1 -->\nB\n", "raw_b");
    saveDraft(makeDraft({
      nodeId: "test/concept/from-a",
      filePath: "wiki/concepts/from-a.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/from-a",
        sourceIds: ["raw_a"],
        sourceChase: ["raw/chase/raw_a.md"],
        title: "from-a",
        tags: ["compare-x"],
      },
    }));
    saveDraft(makeDraft({
      nodeId: "test/concept/from-b",
      filePath: "wiki/concepts/from-b.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/from-b",
        sourceIds: ["raw_b"],
        sourceChase: ["raw/chase/raw_b.md"],
        title: "from-b",
        tags: ["compare-x"],
      },
    }));
    const board = await buildQueryBoard(config, "compare", { mode: "compare" });
    // seedNodes 应包含两个 source 的节点
    const sourceIds = new Set(board.seedNodes.flatMap((n) => n.sourceIds));
    expect(sourceIds.has("raw_a")).toBe(true);
    expect(sourceIds.has("raw_b")).toBe(true);
  });
});

describe("board — challenge mode", () => {
  it("challenge mode 包含 limitNodes（节点 limits 非空）", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft({
      nodeId: "test/concept/with-limit",
      filePath: "wiki/concepts/with-limit.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/with-limit",
        title: "with-limit",
      },
      limits: ["this only works under X"],
    }));
    const board = await buildQueryBoard(config, "1/e", { mode: "challenge" });
    expect(board.limitNodes.some((n) => n.nodeId === "test/concept/with-limit")).toBe(true);
  });

  it("challenge mode 包含 counterNodes（kind=counter）", async () => {
    setupChase("<!-- chunk 1 -->\nA\n", "raw_c");
    saveDraft(makeDraft({
      nodeId: "test/counter/c1",
      kind: "counter",
      filePath: "wiki/counters/c1.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/counter/c1",
        kind: "counter",
        sourceIds: ["raw_c"],
        sourceChase: ["raw/chase/raw_c.md"],
        title: "counter view",
      },
      claim: "a counter",
    }));
    const board = await buildQueryBoard(config, "anything", { mode: "challenge" });
    expect(board.counterNodes.some((n) => n.nodeId === "test/counter/c1")).toBe(true);
  });

  it("challenge mode instructions: synthesisLevel='strict', requireEvidenceBoundary=true", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const board = await buildQueryBoard(config, "1/e", { mode: "challenge" });
    expect(board.instructions.synthesisLevel).toBe("strict");
    expect(board.instructions.outputBoundaries.requireEvidenceBoundary).toBe(true);
  });
});

describe("board — mode alias (BOARD_MODE_ALIASES)", () => {
  it("exact alias → trace", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const board = await buildQueryBoard(config, "1/e", { mode: "exact" as BoardMode });
    expect(board.mode).toBe("trace");
  });

  it("explore alias → expand", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const board = await buildQueryBoard(config, "1/e", { mode: "explore" as BoardMode });
    expect(board.mode).toBe("expand");
  });

  it("counter alias → challenge", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const board = await buildQueryBoard(config, "1/e", { mode: "counter" as BoardMode });
    expect(board.mode).toBe("challenge");
  });

  it("非法 mode 回退到 ask", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const board = await buildQueryBoard(config, "1/e", { mode: "bogus" as BoardMode });
    expect(board.mode).toBe("ask");
  });
});

describe("board — 过滤", () => {
  it("--node 强制某 node 为 seed", async () => {
    setupChase("<!-- chunk 1 -->\nA\n", "raw_a");
    setupChase("<!-- chunk 1 -->\nB\n", "raw_b");
    saveDraft(makeDraft({
      nodeId: "test/concept/a",
      filePath: "wiki/concepts/a.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/a",
        sourceIds: ["raw_a"],
        sourceChase: ["raw/chase/raw_a.md"],
        title: "a",
      },
    }));
    saveDraft(makeDraft({
      nodeId: "test/concept/b",
      filePath: "wiki/concepts/b.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/b",
        sourceIds: ["raw_b"],
        sourceChase: ["raw/chase/raw_b.md"],
        title: "b",
      },
    }));
    const board = await buildQueryBoard(config, "anything", {
      mode: "ask",
      nodeId: "test/concept/b",
    });
    expect(board.seedNodes.some((n) => n.nodeId === "test/concept/b")).toBe(true);
  });

  it("--source 过滤只召回匹配 source", async () => {
    setupChase("<!-- chunk 1 -->\nA\n", "raw_a");
    setupChase("<!-- chunk 1 -->\nB\n", "raw_b");
    saveDraft(makeDraft({
      nodeId: "test/concept/a",
      filePath: "wiki/concepts/a.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/a",
        sourceIds: ["raw_a"],
        sourceChase: ["raw/chase/raw_a.md"],
        title: "a",
      },
    }));
    saveDraft(makeDraft({
      nodeId: "test/concept/b",
      filePath: "wiki/concepts/b.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/b",
        sourceIds: ["raw_b"],
        sourceChase: ["raw/chase/raw_b.md"],
        title: "b",
      },
    }));
    const board = await buildQueryBoard(config, "anything", {
      mode: "ask",
      source: "raw_a",
    });
    expect(board.seedNodes.every((n) => n.sourceIds.includes("raw_a"))).toBe(true);
  });
});

describe("board — gaps", () => {
  it("无匹配 wiki 时 gapped: question=原 question, reason=无覆盖", async () => {
    const board = await buildQueryBoard(config, "completely novel question", { mode: "ask" });
    expect(board.gaps.length).toBeGreaterThan(0);
    expect(board.gaps[0]?.question).toBe("completely novel question");
    expect(board.gaps[0]?.reason).toMatch(/no.*wiki|empty/i);
  });
});
