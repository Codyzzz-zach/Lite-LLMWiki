/**
 * audit-writeback — 验证 audit 结果写回 wiki frontmatter
 *
 * 覆盖：
 * - 结构 audit 写回 auditStatus
 * - 语义 audit 写回 auditStatus + auditScore
 * - 写回保留 body 内容不变
 * - 写回幂等（重复调用不破坏文件）
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { auditWiki, writeAuditResults } from "../src/knowledge/audit.js";
import { writeSemanticAuditResults } from "../src/knowledge/semantic-audit.js";
import { parseWikiContent } from "../src/knowledge/wiki-parser.js";
import type { AppConfig, AuditResult, SemanticAuditResult } from "../src/types.js";

function makeConfig(tmp: string): AppConfig {
  return {
    apiKey: "test-key",
    baseUrl: "https://api.example.com",
    projectRoot: tmp,
    rawDir: join(tmp, "raw"),
    wikiDir: join(tmp, "wiki"),
    model: "test-model",
    chunkTokenTarget: 500,
    chunkOverlapTokens: 50,
  };
}

const WIKI_NODE_A = `---
nodeId: node-a
kind: concept
title: Node A
sourceIds:
  - raw/pdf/test
sourceChase:
  - raw/chase/test.md
propRefs:
  - "1"
confidence: 0.9
tags:
  - test
---

## Claim
This is a test claim.

## Evidence
- Test evidence line 1.

## Interpretation
Test interpretation.

## Limits
- Test limit.
`;

const WIKI_NODE_B = `---
nodeId: node-b
kind: concept
title: Node B
sourceIds:
  - raw/pdf/test
sourceChase:
  - raw/chase/test.md
propRefs:
  - "1"
confidence: 0.9
tags:
  - test
---

## Claim
Another claim.

## Evidence
- Another evidence line.

## Interpretation
Another interpretation.

## Limits
- Another limit.
`;

function setupTmpWiki(tmp: string) {
  mkdirSync(join(tmp, "wiki", "concepts"), { recursive: true });
  mkdirSync(join(tmp, "raw", "chase"), { recursive: true });

  writeFileSync(join(tmp, "wiki", "concepts", "node-a.md"), WIKI_NODE_A, "utf-8");
  writeFileSync(join(tmp, "wiki", "concepts", "node-b.md"), WIKI_NODE_B, "utf-8");

  writeFileSync(
    join(tmp, "raw", "chase", "test.md"),
    "[//]: # (chunk:1)\nTest chase content.\n",
    "utf-8",
  );
}

describe("Audit writeback — 结构 audit writeAuditResults", () => {
  let tmp: string;
  let config: AppConfig;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "audit-wb-"));
    config = makeConfig(tmp);
    setupTmpWiki(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writeAuditResults 存在且为函数", () => {
    expect(typeof writeAuditResults).toBe("function");
  });

  it("audit 结果为 passed 时写回 auditStatus=passed", () => {
    // 手动构造 passed 的 AuditResult
    const result: AuditResult = {
      ok: true,
      summary: { nodes: 2, verifiedNodes: 2, missingEvidence: 0, invalidChunkRefs: 0, coverage: 1 },
      issues: [],
    };
    writeAuditResults(config, result);

    const content = readFileSync(join(tmp, "wiki", "concepts", "node-a.md"), "utf-8");
    const parsed = parseWikiContent(content, "wiki/concepts/node-a.md");
    expect(parsed.frontmatter.auditStatus).toBe("passed");
  });

  it("audit 结果含 error 时写回 auditStatus=failed 给对应节点", () => {
    const result: AuditResult = {
      ok: false,
      summary: { nodes: 2, verifiedNodes: 1, missingEvidence: 1, invalidChunkRefs: 0, coverage: 0.5 },
      issues: [
        { severity: "error", filePath: "wiki/concepts/node-b.md", message: "Missing evidence" },
      ],
    };
    writeAuditResults(config, result);

    // node-a should be passed (no error for it)
    const a = readFileSync(join(tmp, "wiki", "concepts", "node-a.md"), "utf-8");
    const pa = parseWikiContent(a, "wiki/concepts/node-a.md");
    expect(pa.frontmatter.auditStatus).toBe("passed");

    // node-b should be failed
    const b = readFileSync(join(tmp, "wiki", "concepts", "node-b.md"), "utf-8");
    const pb = parseWikiContent(b, "wiki/concepts/node-b.md");
    expect(pb.frontmatter.auditStatus).toBe("failed");
  });

  it("写回保留 body 内容不变", () => {
    const before = readFileSync(join(tmp, "wiki", "concepts", "node-a.md"), "utf-8");
    const beforeBody = before.split("---").slice(2).join("---").trim();

    const result: AuditResult = {
      ok: true,
      summary: { nodes: 2, verifiedNodes: 2, missingEvidence: 0, invalidChunkRefs: 0, coverage: 1 },
      issues: [],
    };
    writeAuditResults(config, result);

    const after = readFileSync(join(tmp, "wiki", "concepts", "node-a.md"), "utf-8");
    const afterBody = after.split("---").slice(2).join("---").trim();
    expect(afterBody).toBe(beforeBody);
  });

  it("写回幂等 — 重复调用不破坏 frontmatter", () => {
    const result: AuditResult = {
      ok: true,
      summary: { nodes: 2, verifiedNodes: 2, missingEvidence: 0, invalidChunkRefs: 0, coverage: 1 },
      issues: [],
    };
    writeAuditResults(config, result);
    writeAuditResults(config, result);

    const content = readFileSync(join(tmp, "wiki", "concepts", "node-a.md"), "utf-8");
    const parsed = parseWikiContent(content, "wiki/concepts/node-a.md");
    expect(parsed.frontmatter.auditStatus).toBe("passed");
    expect(parsed.sections.claim).toContain("test claim");
  });
});

describe("Audit writeback — 语义 audit writeSemanticAuditResults", () => {
  let tmp: string;
  let config: AppConfig;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "audit-sem-"));
    config = makeConfig(tmp);
    setupTmpWiki(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writeSemanticAuditResults 存在且为函数", () => {
    expect(typeof writeSemanticAuditResults).toBe("function");
  });

  it("无 issue 时写回 auditStatus=passed + auditScore", () => {
    const result: SemanticAuditResult = {
      ok: true,
      summary: { nodes: 2, passed: 2, warning: 0, failed: 0, averageScore: 0.95 },
      issues: [],
      nodeScores: { "node-a": 0.95, "node-b": 0.95 },
    };
    writeSemanticAuditResults(config, result);

    const content = readFileSync(join(tmp, "wiki", "concepts", "node-a.md"), "utf-8");
    const parsed = parseWikiContent(content, "wiki/concepts/node-a.md");
    expect(parsed.frontmatter.auditStatus).toBe("passed");
    expect(typeof parsed.frontmatter.auditScore).toBe("number");
  });

  it("warning issue 写回 auditStatus=warning 给对应节点", () => {
    const result: SemanticAuditResult = {
      ok: true,
      summary: { nodes: 2, passed: 1, warning: 1, failed: 0, averageScore: 0.8 },
      issues: [
        {
          nodeId: "node-a",
          filePath: "wiki/concepts/node-a.md",
          severity: "warning",
          dimension: "limits",
          claim: "test",
          evidenceExcerpt: "test",
          reason: "missing limits",
        },
      ],
    };
    writeSemanticAuditResults(config, result);

    const a = readFileSync(join(tmp, "wiki", "concepts", "node-a.md"), "utf-8");
    const pa = parseWikiContent(a, "wiki/concepts/node-a.md");
    expect(pa.frontmatter.auditStatus).toBe("warning");
  });

  it("error issue 写回 auditStatus=failed 给对应节点", () => {
    const result: SemanticAuditResult = {
      ok: false,
      summary: { nodes: 2, passed: 0, warning: 0, failed: 2, averageScore: 0.3 },
      issues: [
        {
          nodeId: "node-a",
          filePath: "wiki/concepts/node-a.md",
          severity: "error",
          dimension: "support",
          claim: "test",
          evidenceExcerpt: "test",
          reason: "unsupported claim",
        },
      ],
    };
    writeSemanticAuditResults(config, result);

    const content = readFileSync(join(tmp, "wiki", "concepts", "node-a.md"), "utf-8");
    const parsed = parseWikiContent(content, "wiki/concepts/node-a.md");
    expect(parsed.frontmatter.auditStatus).toBe("failed");
  });

  it("error 优先级高于 warning（同节点同时有 error 和 warning 时为 failed）", () => {
    const result: SemanticAuditResult = {
      ok: false,
      summary: { nodes: 2, passed: 0, warning: 1, failed: 1, averageScore: 0.4 },
      issues: [
        {
          nodeId: "node-a",
          filePath: "wiki/concepts/node-a.md",
          severity: "warning",
          dimension: "limits",
          claim: "test",
          evidenceExcerpt: "test",
          reason: "missing limits",
        },
        {
          nodeId: "node-a",
          filePath: "wiki/concepts/node-a.md",
          severity: "error",
          dimension: "support",
          claim: "test",
          evidenceExcerpt: "test",
          reason: "unsupported",
        },
      ],
    };
    writeSemanticAuditResults(config, result);

    const content = readFileSync(join(tmp, "wiki", "concepts", "node-a.md"), "utf-8");
    const parsed = parseWikiContent(content, "wiki/concepts/node-a.md");
    expect(parsed.frontmatter.auditStatus).toBe("failed");
  });
});
