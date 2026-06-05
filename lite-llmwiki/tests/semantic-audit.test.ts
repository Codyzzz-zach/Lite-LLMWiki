/**
 * semantic-audit — 语义审查核心单测
 *
 * 覆盖（plan 7.4-7.8）：
 * - runSemanticAudit(config) 返回 SemanticAuditResult
 * - 单 node 路径：nodeId 过滤
 * - source 路径：source 过滤
 * - chase 缺失 → 该 node 直接 error（不调 LLM）
 * - chunkRefs 缺失 → 该 node 直接 error（不调 LLM）
 * - LLM 返回非 JSON → 该 node 记 warning + raw response 摘要
 * - 单 node LLM 失败不影响其他 node
 * - summary 统计正确
 * - LLM judge 注入（mock），不依赖真实 API
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppConfig,
  SemanticAuditIssue,
  SemanticAuditResult,
  SemanticJudgeVerdict,
} from "../src/types.js";
import { renderWikiNode } from "../src/knowledge/render.js";
import { runSemanticAudit } from "../src/knowledge/semantic-audit.js";
import type { WikiNodeDraft } from "../src/types.js";

let tmpDir: string;
let config: AppConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "semantic-audit-test-"));
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
  const relPath = draft.filePath.startsWith("wiki/")
    ? draft.filePath.slice(5)
    : draft.filePath;
  const fullPath = join(config.wikiDir, relPath);
  require("node:fs").mkdirSync(require("node:path").dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, renderWikiNode(draft), "utf-8");
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
      chunkRefs: [1, 2],
      confidence: 0.8,
      status: "verified",
      tags: ["a"],
      related: [],
    },
    claim: "claim",
    evidence: [{ sourceId: "raw_x-abcd", chunkRefs: [1, 2], summary: "sum" }],
    ...overrides,
  };
}

function setupChase(content: string, name = "raw_x-abcd") {
  const dir = join(config.rawDir, "chase");
  require("node:fs").mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), content, "utf-8");
}

function mockJudge(verdict: SemanticJudgeVerdict) {
  return vi.fn(async () => JSON.stringify(verdict));
}

function okVerdict(nodeId: string, score = 0.95): SemanticJudgeVerdict {
  return {
    nodeId,
    verdict: "passed",
    score,
    support: "aligned",
    addition: "none",
    inference: "ok",
    limits: "ok",
    citation: "ok",
    issues: [],
  };
}

describe("semantic-audit — 基本行为", () => {
  it("空 wiki 库返回 ok=true summary.nodes=0", async () => {
    const result = await runSemanticAudit(config, {
      llmJudge: mockJudge(okVerdict("none")),
    });
    expect(result.ok).toBe(true);
    expect(result.summary.nodes).toBe(0);
  });

  it("单个 v5 节点 + mock judge passed → ok=true", async () => {
    setupChase("<!-- chunk 1 -->\nA\n<!-- chunk 2 -->\nB\n");
    saveDraft(makeDraft());
    const result = await runSemanticAudit(config, {
      llmJudge: mockJudge(okVerdict("test/concept/x")),
    });
    expect(result.ok).toBe(true);
    expect(result.summary.nodes).toBe(1);
    expect(result.summary.passed).toBe(1);
    expect(result.summary.warning).toBe(0);
    expect(result.summary.failed).toBe(0);
    expect(result.summary.averageScore).toBeCloseTo(0.95, 2);
  });
});

describe("semantic-audit — 过滤", () => {
  it("--node 过滤只审指定 node", async () => {
    setupChase("<!-- chunk 1 -->\nA\n", "raw_a");
    setupChase("<!-- chunk 1 -->\nB\n", "raw_b");
    saveDraft(makeDraft({
      nodeId: "test/concept/a",
      filePath: "wiki/concepts/test-a.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/a",
        sourceIds: ["raw_a"],
        sourceChase: ["raw/chase/raw_a.md"],
      },
    }));
    saveDraft(makeDraft({
      nodeId: "test/concept/b",
      filePath: "wiki/concepts/test-b.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/b",
        sourceIds: ["raw_b"],
        sourceChase: ["raw/chase/raw_b.md"],
      },
    }));
    const judge = mockJudge(okVerdict("test/concept/b"));
    const result = await runSemanticAudit(config, {
      nodeId: "test/concept/b",
      llmJudge: judge,
    });
    expect(result.summary.nodes).toBe(1);
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("--source 过滤只审包含该 source 的 node", async () => {
    setupChase("<!-- chunk 1 -->\nA\n", "raw_a");
    setupChase("<!-- chunk 1 -->\nB\n", "raw_b");
    saveDraft(makeDraft({
      nodeId: "test/concept/a",
      filePath: "wiki/concepts/test-a.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/a",
        sourceIds: ["raw_a"],
        sourceChase: ["raw/chase/raw_a.md"],
      },
    }));
    saveDraft(makeDraft({
      nodeId: "test/concept/b",
      filePath: "wiki/concepts/test-b.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/b",
        sourceIds: ["raw_b"],
        sourceChase: ["raw/chase/raw_b.md"],
      },
    }));
    const judge = mockJudge(okVerdict("test/concept/a"));
    const result = await runSemanticAudit(config, {
      source: "raw_a",
      llmJudge: judge,
    });
    expect(result.summary.nodes).toBe(1);
    expect(judge).toHaveBeenCalledTimes(1);
  });
});

describe("semantic-audit — 错误处理（spec 7.7）", () => {
  it("chase 缺失 → 该 node 直接 error（不调 LLM）", async () => {
    // 不调用 setupChase
    saveDraft(makeDraft());
    const judge = vi.fn();
    const result = await runSemanticAudit(config, { llmJudge: judge });
    expect(judge).not.toHaveBeenCalled();
    expect(result.summary.failed).toBe(1);
    expect(result.issues.some((i: SemanticAuditIssue) =>
      i.dimension === "citation" && /chase/i.test(i.reason),
    )).toBe(true);
  });

  it("chunkRefs 缺失 → 该 node 直接 error（不调 LLM）", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    // 直接写一个没有 chunkRefs 的 v5 节点（绕过 render 的 chunkRefs 必填校验）
    const fp = join(config.wikiDir, "concepts", "test-x.md");
    require("node:fs").mkdirSync(require("node:path").dirname(fp), { recursive: true });
    const md = [
      "---",
      "nodeId: test/concept/x",
      "kind: concept",
      "title: X",
      "sourceIds:",
      "  - raw_x-abcd",
      "sourceChase:",
      "  - raw/chase/raw_x-abcd.md",
      "tags: []",
      "related: []",
      "---",
      "",
      "## Claim",
      "c",
      "",
    ].join("\n");
    writeFileSync(fp, md, "utf-8");
    const judge = vi.fn();
    const result = await runSemanticAudit(config, { llmJudge: judge });
    expect(judge).not.toHaveBeenCalled();
    expect(result.summary.failed).toBe(1);
    expect(result.issues.some((i) => /chunkRef/i.test(i.reason))).toBe(true);
  });

  it("LLM 返回非 JSON → 该 node 记 warning + raw response 摘要", async () => {
    setupChase("<!-- chunk 1 -->\nA\n<!-- chunk 2 -->\nB\n");
    saveDraft(makeDraft());
    const judge = vi.fn(async () => "not json at all");
    const result = await runSemanticAudit(config, { llmJudge: judge });
    expect(result.summary.warning).toBe(1);
    expect(result.summary.failed).toBe(0);
    // raw response 摘要进 issues
    expect(result.issues.some((i) => /not json/i.test(i.reason))).toBe(true);
  });

  it("单 node LLM 失败不影响其他 node 审查", async () => {
    setupChase("<!-- chunk 1 -->\nA\n", "raw_a");
    setupChase("<!-- chunk 1 -->\nB\n", "raw_b");
    saveDraft(makeDraft({
      nodeId: "test/concept/a",
      filePath: "wiki/concepts/test-a.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/a",
        sourceIds: ["raw_a"],
        sourceChase: ["raw/chase/raw_a.md"],
      },
    }));
    saveDraft(makeDraft({
      nodeId: "test/concept/b",
      filePath: "wiki/concepts/test-b.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/b",
        sourceIds: ["raw_b"],
        sourceChase: ["raw/chase/raw_b.md"],
      },
    }));
    const judge = vi
      .fn()
      .mockRejectedValueOnce(new Error("LLM 1 failed"))
      .mockResolvedValueOnce(JSON.stringify(okVerdict("test/concept/b", 0.8)));
    const result = await runSemanticAudit(config, { llmJudge: judge });
    // 一个 failed（LLM 抛错） + 一个 passed
    expect(result.summary.nodes).toBe(2);
    expect(result.summary.passed).toBe(1);
    expect(result.summary.failed).toBe(1);
  });

  it("LLM 抛异常 → 该 node failed（spec 7.7 单 node 隔离）", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const judge = vi.fn(async () => {
      throw new Error("API down");
    });
    const result = await runSemanticAudit(config, { llmJudge: judge });
    expect(result.summary.failed).toBe(1);
    expect(result.issues.some((i) => /API down/i.test(i.reason))).toBe(true);
  });
});

describe("semantic-audit — 汇总统计", () => {
  it("混合 passed / warning / failed 平均分正确", async () => {
    setupChase("<!-- chunk 1 -->\nA\n", "raw_a");
    setupChase("<!-- chunk 1 -->\nB\n", "raw_b");
    setupChase("<!-- chunk 1 -->\nC\n", "raw_c");
    saveDraft(makeDraft({
      nodeId: "test/concept/a",
      filePath: "wiki/concepts/test-a.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/a",
        sourceIds: ["raw_a"],
        sourceChase: ["raw/chase/raw_a.md"],
      },
    }));
    saveDraft(makeDraft({
      nodeId: "test/concept/b",
      filePath: "wiki/concepts/test-b.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/b",
        sourceIds: ["raw_b"],
        sourceChase: ["raw/chase/raw_b.md"],
      },
    }));
    saveDraft(makeDraft({
      nodeId: "test/concept/c",
      filePath: "wiki/concepts/test-c.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/c",
        sourceIds: ["raw_c"],
        sourceChase: ["raw/chase/raw_c.md"],
      },
    }));
    const judge = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(okVerdict("test/concept/a", 1.0)))
      .mockResolvedValueOnce(JSON.stringify({ ...okVerdict("test/concept/b", 0.7), verdict: "warning" }))
      .mockResolvedValueOnce(JSON.stringify({ ...okVerdict("test/concept/c", 0.4), verdict: "failed" }));
    const result = await runSemanticAudit(config, { llmJudge: judge });
    expect(result.summary.nodes).toBe(3);
    expect(result.summary.passed).toBe(1);
    expect(result.summary.warning).toBe(1);
    expect(result.summary.failed).toBe(1);
    expect(result.summary.averageScore).toBeCloseTo((1.0 + 0.7 + 0.4) / 3, 2);
    expect(result.ok).toBe(false); // 有 failed → ok=false
  });
});

describe("semantic-audit — issue 维度映射", () => {
  it("LLM 报 citation issue → dimension: citation", async () => {
    setupChase("<!-- chunk 1 -->\nA\n<!-- chunk 2 -->\nB\n");
    saveDraft(makeDraft());
    const verdict: SemanticJudgeVerdict = {
      ...okVerdict("test/concept/x"),
      citation: "warning",
      issues: ["chunkRef 1 不覆盖关键 evidence"],
    };
    const judge = vi.fn(async () => JSON.stringify(verdict));
    const result = await runSemanticAudit(config, { llmJudge: judge });
    // 整体 verdict 是 passed → bucket passed；但 citation 维度有 warning
    expect(result.summary.passed).toBe(1);
    // 应该有 LLM 报告的具体 issue（带原文文本）
    const llmIssue = result.issues.find((i) => i.dimension === "citation" && /chunkRef 1/.test(i.reason));
    expect(llmIssue).toBeDefined();
  });

  it("LLM 报 limits issue → dimension: limits", async () => {
    setupChase("<!-- chunk 1 -->\nA\n<!-- chunk 2 -->\nB\n");
    saveDraft(makeDraft());
    const verdict: SemanticJudgeVerdict = {
      ...okVerdict("test/concept/x"),
      limits: "warning",
      issues: ["原文有条件 X，wiki 没写进 Limits"],
    };
    const judge = vi.fn(async () => JSON.stringify(verdict));
    const result = await runSemanticAudit(config, { llmJudge: judge });
    expect(result.summary.passed).toBe(1);
    expect(result.issues.some((i) => i.dimension === "limits")).toBe(true);
  });
});

describe("semantic-audit — ok 字段语义", () => {
  it("全部 passed → ok=true", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const judge = mockJudge(okVerdict("test/concept/x"));
    const result = await runSemanticAudit(config, { llmJudge: judge });
    expect(result.ok).toBe(true);
  });

  it("只有 warning → ok=true（不阻塞，agent 决定）", async () => {
    setupChase("<!-- chunk 1 -->\nA\n");
    saveDraft(makeDraft());
    const judge = mockJudge({ ...okVerdict("test/concept/x"), verdict: "warning" });
    const result = await runSemanticAudit(config, { llmJudge: judge });
    expect(result.ok).toBe(true);
    expect(result.summary.warning).toBe(1);
  });

  it("任一 failed → ok=false", async () => {
    setupChase("<!-- chunk 1 -->\nA\n", "raw_a");
    setupChase("<!-- chunk 1 -->\nB\n", "raw_b");
    saveDraft(makeDraft({
      nodeId: "test/concept/a",
      filePath: "wiki/concepts/test-a.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/a",
        sourceIds: ["raw_a"],
        sourceChase: ["raw/chase/raw_a.md"],
      },
    }));
    saveDraft(makeDraft({
      nodeId: "test/concept/b",
      filePath: "wiki/concepts/test-b.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/concept/b",
        sourceIds: ["raw_b"],
        sourceChase: ["raw/chase/raw_b.md"],
      },
    }));
    const judge = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(okVerdict("test/concept/a")))
      .mockResolvedValueOnce(JSON.stringify({ ...okVerdict("test/concept/b"), verdict: "failed" }));
    const result = await runSemanticAudit(config, { llmJudge: judge });
    expect(result.ok).toBe(false);
  });
});
