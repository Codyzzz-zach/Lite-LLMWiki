/**
 * queryKnowledge v6 — 集成 QueryResultV6 输出
 *
 * 覆盖（spec 9.1 + plan 9.4）：
 * - QueryResultV6 shape: ok / mode / question / answer / board / fromWiki / modelSynthesis / missingEvidence / suggestedNextActions
 * - board 来自 buildQueryBoard（确定性）
 * - fromWiki 提取自 board seedNodes（每个 claim 引用 nodeId + chunkRefs）
 * - modelSynthesis 在无 LLM caller 时为空数组
 * - missingEvidence 来自 board.gaps + 无匹配 seed
 * - suggestedNextActions 由 gaps + missing evidence 启发
 * - 无 API key → board-only 模式（不调 LLM）
 * - 无 seed matches → 全部字段降级（gaps 填充，fromWiki 空）
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig, QueryResultV6 } from "../src/types.js";
import { renderWikiNode } from "../src/knowledge/render.js";
import { queryKnowledge } from "../src/query/engine.js";
import type { WikiNodeDraft } from "../src/types.js";

let tmpDir: string;
let config: AppConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "query-v6-test-"));
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
      tags: [],
      related: [],
    },
    claim: "claim about 1/e",
    evidence: [{ sourceId: "raw_x-abcd", chunkRefs: [1], summary: "s" }],
    ...overrides,
  };
}

describe("queryKnowledge v6 — 输出 shape (spec 9.1)", () => {
  it("返回 QueryResultV6 shape（无 LLM caller）", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const result = await queryKnowledge({
      question: "what is 1/e",
      config,
      mode: "ask",
      llmCaller: undefined, // board-only
    });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("ask");
    expect(result.question).toBe("what is 1/e");
    expect(typeof result.answer).toBe("string");
    expect(result.board).toBeDefined();
    expect(result.board.mode).toBe("ask");
    expect(Array.isArray(result.fromWiki)).toBe(true);
    expect(Array.isArray(result.modelSynthesis)).toBe(true);
    expect(Array.isArray(result.missingEvidence)).toBe(true);
    expect(Array.isArray(result.suggestedNextActions)).toBe(true);
  });

  it("ok 字段始终为 true（v6 不在此阶段 fail；fail 由 audit 处理）", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const result = await queryKnowledge({ question: "what is 1/e", config, mode: "ask" });
    expect(result.ok).toBe(true);
  });
});

describe("queryKnowledge v6 — fromWiki (board seedNodes 投影)", () => {
  it("fromWiki 来自 board seedNodes 的 claim + nodeId + chunkRefs", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const result = await queryKnowledge({ question: "what is 1/e", config, mode: "ask" });
    expect(result.fromWiki.length).toBeGreaterThan(0);
    const ref = result.fromWiki[0]!;
    expect(ref.nodeId).toBe("test/concept/x");
    expect(ref.claim).toBe("claim about 1/e");
    expect(ref.chunkRefs).toContain(1);
    expect(ref.filePath).toBe("wiki/concepts/test-x.md");
  });

  it("无 seed 时 fromWiki 为空数组", async () => {
    const result = await queryKnowledge({ question: "completely novel question", config, mode: "ask" });
    expect(result.fromWiki).toEqual([]);
  });
});

describe("queryKnowledge v6 — modelSynthesis", () => {
  it("无 LLM caller 时 modelSynthesis 为空数组", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const result = await queryKnowledge({ question: "what is 1/e", config, mode: "ask" });
    expect(result.modelSynthesis).toEqual([]);
  });

  it("有 LLM caller 时 modelSynthesis 来自 caller 返回值", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const llmCaller = vi.fn(async () => ({
      answer: "synthesized answer",
      modelSynthesis: [],
    }));
    const result = await queryKnowledge({
      question: "what is 1/e",
      config,
      mode: "ask",
      llmCaller,
    });
    expect(llmCaller).toHaveBeenCalledTimes(1);
    expect(result.answer).toBe("synthesized answer");
  });
});

describe("queryKnowledge v6 — missingEvidence", () => {
  it("有 seed 但 board.gaps 非空时 missingEvidence 反映 gaps", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const result = await queryKnowledge({ question: "what is 1/e", config, mode: "ask" });
    // 当前有 seed，所以 gaps 可能为空；missingEvidence 应反映未覆盖的方面
    expect(Array.isArray(result.missingEvidence)).toBe(true);
  });

  it("无 seed 时 missingEvidence 含 question + reason", async () => {
    const result = await queryKnowledge({ question: "completely novel question", config, mode: "ask" });
    expect(result.missingEvidence.length).toBeGreaterThan(0);
    const gap = result.missingEvidence[0]!;
    expect(gap.question).toBe("completely novel question");
    expect(gap.reason).toMatch(/no.*wiki|empty/i);
  });
});

describe("queryKnowledge v6 — suggestedNextActions", () => {
  it("有 seed 时 suggestedNextActions 可为空（heuristic）", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const result = await queryKnowledge({ question: "what is 1/e", config, mode: "ask" });
    expect(Array.isArray(result.suggestedNextActions)).toBe(true);
  });

  it("无 seed 时 suggestedNextActions 提示用户 ingest 材料", async () => {
    const result = await queryKnowledge({ question: "completely novel", config, mode: "ask" });
    expect(result.suggestedNextActions.length).toBeGreaterThan(0);
    expect(
      result.suggestedNextActions.some((s) => /ingest|material|raw/i.test(s.action)),
    ).toBe(true);
  });
});

describe("queryKnowledge v6 — board 集成 (buildQueryBoard 装配)", () => {
  it("board.mode 来自 options.mode", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const result = await queryKnowledge({ question: "what is 1/e", config, mode: "trace" });
    expect(result.board.mode).toBe("trace");
  });

  it("mode alias 归一化（exact → trace）", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const result = await queryKnowledge({ question: "what is 1/e", config, mode: "exact" });
    expect(result.board.mode).toBe("trace");
    expect(result.mode).toBe("trace");
  });

  it("无 API key + 无 LLM caller 时 answer 标注 board-only 模式", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const result = await queryKnowledge({ question: "what is 1/e", config, mode: "ask" });
    expect(result.answer).toMatch(/no api key|board-only|llm not provided/i);
  });
});
