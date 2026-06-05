/**
 * query CLI — `runQueryCli` 集成测试
 *
 * 覆盖：
 * - runQueryCli 装配 board + 调 LLM
 * - 无 API key 时 board-only 模式（不调 LLM）
 * - JSON 输出含 board + answer
 * - exit code 正确
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig, QueryBoard } from "../src/types.js";
import { renderWikiNode } from "../src/knowledge/render.js";
import { runQueryCli } from "../src/cli/commands/query.js";
import type { WikiNodeDraft } from "../src/types.js";

let tmpDir: string;
let config: AppConfig;
let stdoutSink: string[];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "query-cli-test-"));
  config = {
    rawDir: tmpDir,
    wikiDir: join(tmpDir, "wiki"),
    rootDir: tmpDir,
  } as AppConfig;
  stdoutSink = [];
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

function captureStdout(line: string) {
  stdoutSink.push(line);
}

describe("runQueryCli — board 装配 + LLM 调用", () => {
  it("装配 board 并调 LLM caller", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const llmCaller = vi.fn(async () => ({
      answer: "synthesized answer",
      fromWiki: [],
      modelSynthesis: [],
      missingEvidence: [],
    }));
    const result = await runQueryCli(config, "what is 1/e?", {
      mode: "ask",
      json: true,
      llmCaller,
      stdout: captureStdout,
    });
    expect(llmCaller).toHaveBeenCalledTimes(1);
    expect(result.board.mode).toBe("ask");
    expect(result.answer).toBe("synthesized answer");
    expect(result.exitCode).toBe(0);
  });

  it("无 API key + 无 LLM caller → board-only 模式", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const result = await runQueryCli(config, "what is 1/e?", {
      mode: "ask",
      json: true,
      stdout: captureStdout,
    });
    expect(result.answer).toMatch(/no api key|board-only/i);
    expect(result.board.seedNodes.length).toBeGreaterThan(0);
  });

  it("--mode 传 alias 会被归一化", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const result = await runQueryCli(config, "what is 1/e?", {
      mode: "exact", // → trace
      json: true,
      stdout: captureStdout,
    });
    expect(result.board.mode).toBe("trace");
  });
});

describe("runQueryCli — JSON 输出 shape", () => {
  it("输出含 ok / mode / question / board / answer", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const llmCaller = vi.fn(async () => ({
      answer: "x",
      fromWiki: [],
      modelSynthesis: [],
      missingEvidence: [],
    }));
    await runQueryCli(config, "what is 1/e?", {
      mode: "ask",
      json: true,
      llmCaller,
      stdout: captureStdout,
    });
    const out = JSON.parse(stdoutSink.join(""));
    expect(out).toHaveProperty("ok");
    expect(out).toHaveProperty("mode");
    expect(out).toHaveProperty("question");
    expect(out).toHaveProperty("board");
    expect(out).toHaveProperty("answer");
  });
});
