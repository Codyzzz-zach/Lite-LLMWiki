/**
 * v6 frontmatter + Board 类型单测
 *
 * 覆盖：
 * - M5: BoardInstruction 类型存在且结构合理
 * - M6: BoardMode 归一化（v5 别名 + 合法值 + 默认回退）
 * - M7: boardRoles 在 v5 节点上为可选（不强制要求）
 */
import { describe, expect, it } from "vitest";
import {
  BOARD_MODE_ALIASES,
  normalizeBoardMode,
} from "../src/types.js";
import type {
  BoardInstruction,
  BoardMode,
  BoardNode,
  QueryBoard,
} from "../src/types.js";

describe("v6 frontmatter — 默认值 (X1)", () => {
  it("auditStatus 缺失时默认为 'pending'", async () => {
    const { parseWikiContent } = await import("../src/knowledge/wiki-parser.js");
    const r = parseWikiContent(
      "---\nnodeId: p\nkind: concept\ntitle: p\n---\n## Claim\nx\n",
      "wiki/concepts/p.md",
    );
    expect(r.frontmatter.auditStatus).toBe("pending");
  });

  it("auditStatus 显式 'passed' 时不被覆盖", async () => {
    const { parseWikiContent } = await import("../src/knowledge/wiki-parser.js");
    const r = parseWikiContent(
      "---\nnodeId: q\nkind: concept\ntitle: q\nauditStatus: passed\n---\n## Claim\nx\n",
      "wiki/concepts/q.md",
    );
    expect(r.frontmatter.auditStatus).toBe("passed");
  });

  it("auditStatus 非法值回退到 'pending' 默认（宽容策略）", async () => {
    const { parseWikiContent } = await import("../src/knowledge/wiki-parser.js");
    const r = parseWikiContent(
      "---\nnodeId: r\nkind: concept\ntitle: r\nauditStatus: bogus\n---\n## Claim\nx\n",
      "wiki/concepts/r.md",
    );
    expect(r.frontmatter.auditStatus).toBe("pending");
  });
});

describe("v6 frontmatter — BoardMode 别名 (M6)", () => {
  it("v5 命名 `exact` → `trace`", () => {
    expect(BOARD_MODE_ALIASES.exact).toBe("trace");
    expect(normalizeBoardMode("exact")).toBe("trace");
  });

  it("v5 命名 `explore` → `expand`", () => {
    expect(BOARD_MODE_ALIASES.explore).toBe("expand");
    expect(normalizeBoardMode("explore")).toBe("expand");
  });

  it("v5 命名 `counter` → `challenge`", () => {
    expect(BOARD_MODE_ALIASES.counter).toBe("challenge");
    expect(normalizeBoardMode("counter")).toBe("challenge");
  });

  it("v6 合法值原样返回", () => {
    const modes: BoardMode[] = [
      "ask",
      "trace",
      "expand",
      "compare",
      "challenge",
      "inspire",
    ];
    for (const m of modes) {
      expect(normalizeBoardMode(m)).toBe(m);
    }
  });

  it("大小写不敏感", () => {
    expect(normalizeBoardMode("ASK")).toBe("ask");
    expect(normalizeBoardMode("Trace")).toBe("trace");
  });

  it("非法输入回退到 `ask`", () => {
    expect(normalizeBoardMode("foo")).toBe("ask");
    expect(normalizeBoardMode("")).toBe("ask");
    expect(normalizeBoardMode(null)).toBe("ask");
    expect(normalizeBoardMode(undefined)).toBe("ask");
  });
});

describe("v6 frontmatter — BoardInstruction (M5)", () => {
  it("可以构造一个完整的 BoardInstruction", () => {
    const inst: BoardInstruction = {
      mode: "trace",
      boardSummary: "3 seed nodes, 2 evidence nodes",
      synthesisLevel: "anchored",
      outputBoundaries: {
        requireLayeredOutput: true,
        requirePropRef: true,
        requireEvidenceBoundary: true,
      },
      coverageNote: "wiki covers 80% of question",
    };
    expect(inst.mode).toBe("trace");
    expect(inst.synthesisLevel).toBe("anchored");
    expect(inst.outputBoundaries.requirePropRef).toBe(true);
  });
});

describe("v6 frontmatter — BoardNode.boardRoles 可选 (M7)", () => {
  it("v5 节点（无 boardRoles）可正常构造", () => {
    const node: BoardNode = {
      nodeId: "x",
      kind: "concept",
      title: "x",
      filePath: "wiki/concepts/x.md",
      claim: "c",
      evidence: ["e"],
      interpretation: "i",
      limits: [],
      tags: [],
      sourceIds: [],
      sourceChase: [],
      propRefs: [],
      score: 0.5,
      // boardRoles 故意省略
    };
    expect(node.boardRoles).toBeUndefined();
  });

  it("v6 节点带 boardRoles 也能构造", () => {
    const node: BoardNode = {
      nodeId: "y",
      kind: "concept",
      title: "y",
      filePath: "wiki/concepts/y.md",
      claim: "c",
      evidence: ["e"],
      interpretation: "i",
      limits: [],
      tags: [],
      sourceIds: [],
      sourceChase: [],
      propRefs: [],
      boardRoles: ["evidence", "concept"],
      score: 0.5,
    };
    expect(node.boardRoles).toEqual(["evidence", "concept"]);
  });
});

describe("v6 frontmatter — QueryBoard 必含 instructions", () => {
  it("构造完整 QueryBoard 时 instructions 必填", () => {
    const board: QueryBoard = {
      mode: "ask",
      question: "what is 1/e?",
      seedNodes: [],
      evidenceNodes: [],
      relatedNodes: [],
      limitNodes: [],
      counterNodes: [],
      questionNodes: [],
      sourceExcerpts: [],
      gaps: [],
      instructions: {
        mode: "ask",
        boardSummary: "0 nodes — empty board",
        synthesisLevel: "free",
        outputBoundaries: {
          requireLayeredOutput: true,
          requirePropRef: false,
          requireEvidenceBoundary: true,
        },
      },
    };
    expect(board.instructions.mode).toBe("ask");
  });
});
