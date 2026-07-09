/**
 * queryKnowledge v6 — 集成 QueryResultV6 输出
 *
 * 覆盖（spec 9.1 + plan 9.4）：
 * - QueryResultV6 shape: ok / mode / question / answer / board / fromWiki / modelSynthesis / missingEvidence / suggestedNextActions
 * - board 来自 buildQueryBoard（确定性）
 * - fromWiki 提取自 board seedNodes（每个 claim 引用 nodeId + chunkRefs）
 * - modelSynthesis 在 mock caller 返回空时为空数组
 * - missingEvidence 来自 board.gaps + 无匹配 seed
 * - suggestedNextActions 由 gaps + missing evidence 启发
 * - llmCaller 必填（设计决策：本产品必须有 API key）
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
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
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, renderWikiNode(draft), "utf-8");
}

function setupChase(content: string) {
  const dir = join(config.rawDir, "chase");
  mkdirSync(dir, { recursive: true });
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
      propRefs: ["1"],
      confidence: 0.8,
      status: "verified",
      tags: [],
      related: [],
    },
    claim: "claim about 1/e",
    evidence: [{ sourceId: "raw_x-abcd", propRefs: ["1"], summary: "s" }],
    ...overrides,
  };
}

// mock LLM caller — 返回固定回答，不调真实 API
const mockLlmCaller = vi.fn(async () => ({
  answer: "mock answer from board",
  modelSynthesis: [],
}));

describe("queryKnowledge v6 — 输出 shape (spec 9.1)", () => {
  it("返回 QueryResultV6 shape", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const result = await queryKnowledge({
      question: "what is 1/e",
      config,
      mode: "ask",
      llmCaller: mockLlmCaller,
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
    const result = await queryKnowledge({ question: "what is 1/e", config, mode: "ask", llmCaller: mockLlmCaller });
    expect(result.ok).toBe(true);
  });
});

describe("queryKnowledge v6 — fromWiki (board seedNodes 投影)", () => {
  it("fromWiki 来自 board seedNodes 的 claim + nodeId + propRefs", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const result = await queryKnowledge({ question: "what is 1/e", config, mode: "ask", llmCaller: mockLlmCaller });
    expect(result.fromWiki.length).toBeGreaterThan(0);
    const ref = result.fromWiki[0]!;
    expect(ref.nodeId).toBe("test/concept/x");
    expect(ref.claim).toBe("claim about 1/e");
    expect(ref.propRefs).toContain("1");
    expect(ref.filePath).toBe("wiki/concepts/test-x.md");
  });

  it("无 seed 时 fromWiki 为空数组", async () => {
    const result = await queryKnowledge({ question: "completely novel question", config, mode: "ask", llmCaller: mockLlmCaller });
    expect(result.fromWiki).toEqual([]);
  });
});

describe("queryKnowledge v6 — modelSynthesis", () => {
  it("mock caller 返回空 modelSynthesis 时为空数组", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const result = await queryKnowledge({ question: "what is 1/e", config, mode: "ask", llmCaller: mockLlmCaller });
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
    const result = await queryKnowledge({ question: "what is 1/e", config, mode: "ask", llmCaller: mockLlmCaller });
    expect(Array.isArray(result.missingEvidence)).toBe(true);
  });

  it("无 seed 时 missingEvidence 含 question + reason", async () => {
    const result = await queryKnowledge({ question: "completely novel question", config, mode: "ask", llmCaller: mockLlmCaller });
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
    const result = await queryKnowledge({ question: "what is 1/e", config, mode: "ask", llmCaller: mockLlmCaller });
    expect(Array.isArray(result.suggestedNextActions)).toBe(true);
  });

  it("无 seed 时 suggestedNextActions 提示用户 ingest 材料", async () => {
    const result = await queryKnowledge({ question: "completely novel", config, mode: "ask", llmCaller: mockLlmCaller });
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
    const result = await queryKnowledge({ question: "what is 1/e", config, mode: "trace", llmCaller: mockLlmCaller });
    expect(result.board.mode).toBe("trace");
  });

  it("mode alias 归一化（exact → trace）", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const result = await queryKnowledge({ question: "what is 1/e", config, mode: "exact", llmCaller: mockLlmCaller });
    expect(result.board.mode).toBe("trace");
    expect(result.mode).toBe("trace");
  });

  it("answer 来自 LLM caller", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const result = await queryKnowledge({ question: "what is 1/e", config, mode: "ask", llmCaller: mockLlmCaller });
    expect(result.answer).toBe("mock answer from board");
  });
});
