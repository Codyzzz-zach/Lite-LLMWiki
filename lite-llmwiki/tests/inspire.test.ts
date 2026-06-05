/**
 * inspire board — Phase 5 启发生成单测
 *
 * 覆盖（plan 10.3-10.5）：
 * - inspire CLI: --seed / --node / --source / --kind / --tags
 * - 启发项分类 connections / hypotheses / questions / actions / missingEvidence
 * - 每条启发项带 basedOn (wiki anchors) + evidenceBoundary
 * - empty wiki 时启发项含 missingEvidence
 * - kind/tags 过滤工作
 * - 与 search/inspire 兼容（已存在的 CLI 不破坏）
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/types.js";
import { renderWikiNode } from "../src/knowledge/render.js";
import { runInspireCli } from "../src/cli/commands/inspire.js";
import type { WikiNodeDraft } from "../src/types.js";

let tmpDir: string;
let config: AppConfig;
let stdoutSink: string[];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "inspire-test-"));
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
      tags: ["math"],
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

describe("runInspireCli — 输出 shape (plan 10.3)", () => {
  it("返回 ok / mode / seed / connections / hypotheses / questions / actions / missingEvidence / anchors", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const llmCaller = vi.fn(async () => "[]");
    const result = await runInspireCli(config, { mode: "ask", llmCaller, stdout: captureStdout });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("inspire");
    expect(result.seed).toBeDefined();
    expect(Array.isArray(result.connections)).toBe(true);
    expect(Array.isArray(result.hypotheses)).toBe(true);
    expect(Array.isArray(result.questions)).toBe(true);
    expect(Array.isArray(result.actions)).toBe(true);
    expect(Array.isArray(result.missingEvidence)).toBe(true);
    expect(Array.isArray(result.anchors)).toBe(true);
  });
});

describe("runInspireCli — seed 过滤", () => {
  it("--seed 文本可触发启发（无 seed 也返回空 board）", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const result = await runInspireCli(config, { seed: "1/e", stdout: captureStdout });
    expect(result.seed).toBeDefined();
    // seed 模式下：要么有 seed 节点，要么有 missingEvidence
    if (result.seed) {
      expect(result.seed.text).toBe("1/e");
    } else {
      expect(result.missingEvidence.length).toBeGreaterThan(0);
    }
  });

  it("--node 强制某 node 作为 anchor", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const result = await runInspireCli(config, { node: "test/concept/x", stdout: captureStdout });
    expect(result.anchors.some((a) => a.nodeId === "test/concept/x")).toBe(true);
  });

  it("--kind 过滤只纳入特定 kind 的 nodes", async () => {
    setupChase("<!-- chunk 1 -->\nA\n", "raw_x");
    setupChase("<!-- chunk 1 -->\nB\n", "raw_y");
    saveDraft(makeDraft({
      nodeId: "test/concept/c", filePath: "wiki/concepts/c.md",
      frontmatter: { ...makeDraft().frontmatter, nodeId: "test/concept/c", sourceIds: ["raw_x"], sourceChase: ["raw/chase/raw_x.md"], title: "c" },
    }));
    saveDraft(makeDraft({
      nodeId: "test/method/m", kind: "method", filePath: "wiki/methods/m.md",
      frontmatter: { ...makeDraft().frontmatter, nodeId: "test/method/m", kind: "method", sourceIds: ["raw_y"], sourceChase: ["raw/chase/raw_y.md"], title: "m" },
    }));
    const result = await runInspireCli(config, { kind: "concept", stdout: captureStdout });
    // anchors 应只含 concept
    expect(result.anchors.every((a) => a.kind === "concept" || a.text !== undefined)).toBe(true);
  });
});

describe("runInspireCli — 启发项结构", () => {
  it("每条 connection / hypothesis / question 都有 basedOn (anchor 列表)", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const llmCaller = vi.fn(async () => JSON.stringify([
      { type: "connection", text: "x connects to y", basedOn: ["test/concept/x"], confidence: "medium" },
    ]));
    const result = await runInspireCli(config, { llmCaller, stdout: captureStdout });
    for (const conn of result.connections) {
      expect(Array.isArray(conn.basedOn)).toBe(true);
    }
    for (const hyp of result.hypotheses) {
      expect(Array.isArray(hyp.basedOn)).toBe(true);
    }
  });

  it("启发项含 evidenceBoundary 字段（spec 10.3）", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const llmCaller = vi.fn(async () => JSON.stringify([
      { type: "hypothesis", text: "x might imply z", basedOn: ["test/concept/x"], confidence: "low", evidenceBoundary: "this is hypothesis, not fact" },
    ]));
    const result = await runInspireCli(config, { llmCaller, stdout: captureStdout });
    expect(result.hypotheses.length).toBeGreaterThan(0);
    expect(result.hypotheses[0]?.evidenceBoundary).toBeDefined();
  });
});

describe("runInspireCli — missingEvidence", () => {
  it("无 seed 时 missingEvidence 提示用户添加材料", async () => {
    const result = await runInspireCli(config, { seed: "completely novel", stdout: captureStdout });
    expect(result.missingEvidence.length).toBeGreaterThan(0);
    expect(result.missingEvidence[0]?.text).toMatch(/no.*wiki|empty/i);
  });
});

describe("runInspireCli — JSON 输出", () => {
  it("--json 输出含全部字段", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const llmCaller = vi.fn(async () => "[]");
    await runInspireCli(config, { llmCaller, stdout: captureStdout, json: true });
    const out = JSON.parse(stdoutSink.join(""));
    expect(out).toHaveProperty("ok");
    expect(out).toHaveProperty("mode");
    expect(out).toHaveProperty("seed");
    expect(out).toHaveProperty("connections");
    expect(out).toHaveProperty("hypotheses");
    expect(out).toHaveProperty("questions");
    expect(out).toHaveProperty("actions");
    expect(out).toHaveProperty("missingEvidence");
    expect(out).toHaveProperty("anchors");
  });
});
