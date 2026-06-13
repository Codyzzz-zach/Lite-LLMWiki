/**
 * inspire parse + heuristic fallback 测试
 *
 * 验证：
 * - parseInspireItems 支持 JSON 数组直接返回
 * - parseInspireItems 支持 { items: [...] } 包装格式
 * - parseInspireItems 支持 markdown fenced JSON
 * - LLM 返回非 JSON 时触发 heuristic fallback
 * - heuristic fallback 产出有意义的启发项
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

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "inspire-fallback-"));
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

function setupChase(content: string, name?: string) {
  const dir = join(config.rawDir, "chase");
  require("node:fs").mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name ? `${name}.md` : "raw_x-abcd.md"), content, "utf-8");
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

// ─── parseInspireItems 格式兼容测试 ──────────────────────────────────

describe("parseInspireItems — 格式兼容", () => {
  it("直接 JSON 数组", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const llmCaller = vi.fn(async () => JSON.stringify([
      { type: "connection", text: "x connects to y", basedOn: ["test/concept/x"], confidence: "medium" },
      { type: "question", text: "why?", basedOn: ["test/concept/x"], confidence: "low" },
    ]));
    const result = await runInspireCli(config, { mode: "ask", llmCaller, stdout: () => {} });
    expect(result.connections.length).toBe(1);
    expect(result.questions.length).toBe(1);
  });

  it("{ items: [...] } 包装格式（response_format=json_object 常见返回）", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const llmCaller = vi.fn(async () => JSON.stringify({
      items: [
        { type: "hypothesis", text: "maybe z", basedOn: ["test/concept/x"], confidence: "low" },
      ],
    }));
    const result = await runInspireCli(config, { mode: "ask", llmCaller, stdout: () => {} });
    expect(result.hypotheses.length).toBe(1);
  });

  it("markdown fenced JSON", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const llmCaller = vi.fn(async () => "```json\n" + JSON.stringify([
      { type: "action", text: "do research", basedOn: ["test/concept/x"], confidence: "medium" },
    ]) + "\n```");
    const result = await runInspireCli(config, { mode: "ask", llmCaller, stdout: () => {} });
    expect(result.actions.length).toBe(1);
  });
});

// ─── heuristic fallback 测试 ──────────────────────────────────────────

describe("inspire — heuristic fallback when LLM returns unparseable text", () => {
  it("LLM 返回纯文本 → fallback 到 heuristic", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft({
      nodeId: "test/concept/seed",
      filePath: "wiki/concepts/seed.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/seed",
        title: "seed",
        tags: ["physics"],
      },
      claim: "claim about seed physics 1/e",
    }));
    saveDraft(makeDraft({
      nodeId: "test/insight/rel",
      kind: "insight",
      filePath: "wiki/insights/rel.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/insight/rel",
        kind: "insight",
        title: "insight on physics",
        tags: ["physics"],
      },
      claim: "an insight about quantum",
    }));
    // LLM 返回中文自然语言（不是 JSON）
    const llmCaller = vi.fn(async () => "这是关于1/e的思考。1/e在数学中有多种面貌，包括极限定义和微积分应用。");
    const result = await runInspireCli(config, { mode: "ask", seed: "1/e", llmCaller, stdout: () => {} });
    // 应该 fallback 到 heuristic，产出 tag 共享的 connection
    expect(result.connections.length).toBeGreaterThan(0);
    expect(result.connections.some((c) => c.basedOn.length > 0)).toBe(true);
  });

  it("LLM 返回空 JSON 数组 [] → fallback 到 heuristic", async () => {
    setupChase("<!-- chunk 1 -->\nA\n", "raw_x");
    setupChase("<!-- chunk 1 -->\nB\n", "raw_c");
    saveDraft(makeDraft({
      nodeId: "test/concept/seed",
      filePath: "wiki/concepts/seed.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/seed",
        sourceIds: ["raw_x"],
        sourceChase: ["raw/chase/raw_x.md"],
        title: "seed",
        tags: ["math"],
      },
      claim: "claim about seed",
    }));
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
        tags: [],
      },
      claim: "a counter to the seed",
    }));
    const llmCaller = vi.fn(async () => "[]");
    const result = await runInspireCli(config, { mode: "ask", seed: "1/e", llmCaller, stdout: () => {} });
    // 空数组触发 fallback → heuristic 应产出 question（基于 counter）
    expect(result.questions.length).toBeGreaterThan(0);
  });
});

// ─── 无 LLM caller 时的 heuristic（已有测试，这里验证完整性）─────────

describe("inspire — board-only heuristic（无 API key）", () => {
  it("无 llmCaller → heuristic 产出基于 counter 的 question", async () => {
    setupChase("<!-- chunk 1 -->\nA\n", "raw_x");
    setupChase("<!-- chunk 1 -->\nB\n", "raw_c");
    saveDraft(makeDraft({
      nodeId: "test/concept/seed",
      filePath: "wiki/concepts/seed.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/seed",
        sourceIds: ["raw_x"],
        sourceChase: ["raw/chase/raw_x.md"],
        title: "seed",
        tags: ["physics"],
      },
      claim: "claim about seed 1/e",
    }));
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
        tags: [],
      },
      claim: "a counter to the seed",
    }));
    const result = await runInspireCli(config, { seed: "1/e", stdout: () => {} });
    expect(result.questions.some((q) => q.basedOn.includes("test/counter/c1"))).toBe(true);
  });
});
