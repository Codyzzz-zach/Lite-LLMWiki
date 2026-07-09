/**
 * search-failed-filter — 验证 search/query 默认排除 failed 节点
 *
 * 覆盖：
 * - search 默认不返回 auditStatus=failed 的节点
 * - search --include-failed 返回全部节点
 * - board 装配默认排除 failed 节点
 * - board includeFailed=true 时含 failed 节点
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { searchWiki } from "../src/query/search.js";
import { buildQueryBoard } from "../src/query/board.js";
import type { AppConfig } from "../src/types.js";

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

const NODE_PASSED = `---
nodeId: passed-node
kind: concept
title: Passed Concept
sourceIds:
  - raw/pdf/test
sourceChase:
  - raw/chase/test.md
propRefs:
  - "1"
tags:
  - physics
auditStatus: passed
auditScore: 0.95
---

## Claim
E equals mc squared.

## Evidence
- From Einstein's paper.

## Limits
- Only applies at relativistic speeds.
`;

const NODE_FAILED = `---
nodeId: failed-node
kind: concept
title: Failed Concept
sourceIds:
  - raw/pdf/test
sourceChase:
  - raw/chase/test.md
propRefs:
  - "1"
tags:
  - physics
auditStatus: failed
auditScore: 0.2
---

## Claim
Gravity is fake.

## Evidence
- Personal opinion.

## Limits
`;

const NODE_WARNING = `---
nodeId: warning-node
kind: concept
title: Warning Concept
sourceIds:
  - raw/pdf/test
sourceChase:
  - raw/chase/test.md
propRefs:
  - "1"
tags:
  - physics
auditStatus: warning
auditScore: 0.7
---

## Claim
Quantum entanglement might allow FTL communication.

## Evidence
- Some theoretical speculation.

## Limits
- Not experimentally confirmed.
`;

const NODE_PENDING = `---
nodeId: pending-node
kind: concept
title: Pending Concept
sourceIds:
  - raw/pdf/test
sourceChase:
  - raw/chase/test.md
propRefs:
  - "1"
tags:
  - physics
---

## Claim
The universe is expanding.

## Evidence
- Hubble observations.

## Limits
`;

function setupTmpWiki(tmp: string) {
  mkdirSync(join(tmp, "wiki", "concepts"), { recursive: true });
  mkdirSync(join(tmp, "raw", "chase"), { recursive: true });

  writeFileSync(join(tmp, "wiki", "concepts", "passed-node.md"), NODE_PASSED, "utf-8");
  writeFileSync(join(tmp, "wiki", "concepts", "failed-node.md"), NODE_FAILED, "utf-8");
  writeFileSync(join(tmp, "wiki", "concepts", "warning-node.md"), NODE_WARNING, "utf-8");
  writeFileSync(join(tmp, "wiki", "concepts", "pending-node.md"), NODE_PENDING, "utf-8");

  writeFileSync(
    join(tmp, "raw", "chase", "test.md"),
    "[//]: # (chunk:1)\nChase content for test.\n",
    "utf-8",
  );
}

describe("Search — failed 节点过滤", () => {
  let tmp: string;
  let config: AppConfig;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "search-filter-"));
    config = makeConfig(tmp);
    setupTmpWiki(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("search 默认不返回 auditStatus=failed 的节点", () => {
    const results = searchWiki(config, "physics", { maxResults: 20 });
    const failedResults = results.filter((r) => r.auditStatus === "failed");
    expect(failedResults.length).toBe(0);
  });

  it("search 默认返回 passed/warning/pending 节点", () => {
    const results = searchWiki(config, "physics", { maxResults: 20 });
    const statuses = results.map((r) => r.auditStatus);
    expect(statuses).toContain("passed");
    expect(statuses).toContain("warning");
    // pending 节点（无 auditStatus 字段）也应被包含
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("search includeFailed=true 返回全部节点含 failed", () => {
    const results = searchWiki(config, "physics", { maxResults: 20, includeFailed: true });
    const failedResults = results.filter((r) => r.auditStatus === "failed");
    expect(failedResults.length).toBeGreaterThan(0);
  });

  it("search includeFailed=false 等同默认行为", () => {
    const results = searchWiki(config, "physics", { maxResults: 20, includeFailed: false });
    const failedResults = results.filter((r) => r.auditStatus === "failed");
    expect(failedResults.length).toBe(0);
  });
});

describe("Board — failed 节点过滤", () => {
  let tmp: string;
  let config: AppConfig;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "board-filter-"));
    config = makeConfig(tmp);
    setupTmpWiki(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("board 装配默认排除 auditStatus=failed 节点", async () => {
    const board = await buildQueryBoard(config, "physics concept", {
      mode: "ask",
      maxNodes: 10,
    });

    const allNodes = [
      ...board.seedNodes,
      ...board.evidenceNodes,
      ...board.relatedNodes,
      ...board.limitNodes,
      ...board.counterNodes,
      ...board.questionNodes,
    ];

    const failedNodes = allNodes.filter((n) => n.auditStatus === "failed");
    expect(failedNodes.length).toBe(0);
  });

  it("board includeFailed=true 时含 failed 节点", async () => {
    const board = await buildQueryBoard(config, "physics concept", {
      mode: "ask",
      maxNodes: 10,
      includeFailed: true,
    });

    const allNodes = [
      ...board.seedNodes,
      ...board.evidenceNodes,
      ...board.relatedNodes,
      ...board.limitNodes,
      ...board.counterNodes,
      ...board.questionNodes,
    ];

    const failedNodes = allNodes.filter((n) => n.auditStatus === "failed");
    expect(failedNodes.length).toBeGreaterThan(0);
  });
});
