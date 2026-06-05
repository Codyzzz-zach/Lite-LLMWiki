/**
 * semantic-audit CLI — `runAuditCli` 集成测试
 *
 * 通过 `runAuditCli(config, options)` 测真实 CLI 行为：
 * - 不传 --semantic → 只跑结构 audit
 * - 传 --semantic 但无 llmJudge → 整体 ok=false, stage=semantic-audit
 *   (spec 7.7 API key 缺失错误策略)
 * - 传 --semantic + llmJudge → 调 LLM
 * - 过滤 (--source / --node) 工作
 * - JSON 输出格式正确
 * - exit code 正确 (0 = pass, 2 = fail)
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig, SemanticJudgeVerdict } from "../src/types.js";
import { renderWikiNode } from "../src/knowledge/render.js";
import { runAuditCli } from "../src/cli/commands/audit.js";
import type { WikiNodeDraft } from "../src/types.js";

let tmpDir: string;
let config: AppConfig;
let stdoutSink: string[];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "semantic-cli-test-"));
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
  const relPath = draft.filePath.startsWith("wiki/")
    ? draft.filePath.slice(5)
    : draft.filePath;
  const fullPath = join(config.wikiDir, relPath);
  require("node:fs").mkdirSync(require("node:path").dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, renderWikiNode(draft), "utf-8");
}

function saveDraftWithId(nodeId: string, filePath: string): void {
  const draft = makeDraft({
    nodeId,
    filePath,
    frontmatter: {
      ...makeDraft().frontmatter,
      nodeId,
      title: nodeId.split("/").pop() ?? nodeId,
    },
  });
  saveDraft(draft);
}

function setupChase(content: string) {
  const dir = join(config.rawDir, "chase");
  require("node:fs").mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "raw_x-abcd.md"), content, "utf-8");
}

function okVerdict(nodeId: string): SemanticJudgeVerdict {
  return {
    nodeId,
    verdict: "passed",
    score: 0.95,
    support: "aligned",
    addition: "none",
    inference: "ok",
    limits: "ok",
    citation: "ok",
    issues: [],
  };
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
    claim: "c",
    evidence: [{ sourceId: "raw_x-abcd", chunkRefs: [1], summary: "s" }],
    ...overrides,
  };
}

function captureStdout(line: string) {
  stdoutSink.push(line);
}

describe("runAuditCli — 结构 audit（默认）", () => {
  it("audit --json 走结构 audit 不调 LLM", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const judge = vi.fn();
    const result = await runAuditCli(config, { json: true, llmJudge: judge, stdout: captureStdout });
    expect(judge).not.toHaveBeenCalled();
    expect(result.semantic).toBeNull();
    expect(result.structure.summary.nodes).toBe(1);
    expect(result.exitCode).toBe(0);
    // JSON 输出
    const out = JSON.parse(stdoutSink.join(""));
    expect(out.summary.nodes).toBe(1);
  });

  it("audit --json 输出包含 nodes 字段", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    await runAuditCli(config, { json: true, stdout: captureStdout });
    const out = JSON.parse(stdoutSink.join(""));
    expect(out).toHaveProperty("summary");
    expect(out.summary).toHaveProperty("nodes");
  });
});

describe("runAuditCli --semantic", () => {
  it("--semantic + llmJudge → 调 LLM judge", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const judge = vi.fn(async () => JSON.stringify(okVerdict("test/concept/x")));
    const result = await runAuditCli(config, { semantic: true, json: true, llmJudge: judge, stdout: captureStdout });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(result.semantic).not.toBeNull();
    expect(result.semantic?.summary.passed).toBe(1);
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(stdoutSink.join(""));
    expect(out.semantic.summary.passed).toBe(1);
  });

  it("--semantic 无 llmJudge → ok=false, stage=semantic-audit (spec 7.7 API key 缺失)", async () => {
    saveDraft(makeDraft());
    const result = await runAuditCli(config, { semantic: true, json: true, stdout: captureStdout });
    expect(result.ok).toBe(false);
    expect(result.semantic).not.toBeNull();
    expect(result.semantic?.ok).toBe(false);
    expect(result.semantic?.issues[0]?.reason).toMatch(/stage=semantic-audit/);
    expect(result.exitCode).toBe(2);
  });

  it("--semantic 失败时 exit code = 2", async () => {
    saveDraft(makeDraft());
    // 无 chase → semantic audit 整体 failed
    const judge = vi.fn();
    const result = await runAuditCli(config, { semantic: true, json: true, llmJudge: judge, stdout: captureStdout });
    expect(result.exitCode).toBe(2);
  });
});

describe("runAuditCli — 过滤", () => {
  it("--node 过滤只审指定 node", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraftWithId("test/concept/a", "wiki/concepts/test-a.md");
    saveDraftWithId("test/concept/b", "wiki/concepts/test-b.md");
    const judge = vi.fn(async (p: string) => {
      const m = p.match(/nodeId: (\S+)/);
      return JSON.stringify(okVerdict(m?.[1] ?? ""));
    });
    const result = await runAuditCli(config, {
      semantic: true,
      node: "test/concept/b",
      json: true,
      llmJudge: judge,
      stdout: captureStdout,
    });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(result.semantic?.summary.nodes).toBe(1);
  });

  it("--source 过滤只审匹配 source", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraftWithId("test/concept/a", "wiki/concepts/test-a.md");
    const judge = vi.fn(async () => JSON.stringify(okVerdict("test/concept/a")));
    const result = await runAuditCli(config, {
      semantic: true,
      source: "raw_x",
      json: true,
      llmJudge: judge,
      stdout: captureStdout,
    });
    expect(judge).toHaveBeenCalledTimes(1);
  });
});

describe("runAuditCli — JSON 输出 shape", () => {
  it("无 --semantic 时输出就是 AuditResult（无 semantic 字段）", async () => {
    saveDraft(makeDraft());
    await runAuditCli(config, { json: true, stdout: captureStdout });
    const out = JSON.parse(stdoutSink.join(""));
    expect(out).not.toHaveProperty("semantic");
    expect(out).toHaveProperty("summary");
  });

  it("--semantic 时输出是 { structure, semantic }", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const judge = vi.fn(async () => JSON.stringify(okVerdict("test/concept/x")));
    await runAuditCli(config, {
      semantic: true,
      json: true,
      llmJudge: judge,
      stdout: captureStdout,
    });
    const out = JSON.parse(stdoutSink.join(""));
    expect(out).toHaveProperty("structure");
    expect(out).toHaveProperty("semantic");
  });
});
