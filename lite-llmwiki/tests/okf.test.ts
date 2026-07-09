/**
 * okf — OKF 导出导入单测
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { kindToOkfType, okfTypeToKind } from "../src/okf/mapping.js";
import { exportToOkf } from "../src/okf/export.js";
import { importFromOkf } from "../src/okf/import.js";
import type { AppConfig, WikiKind } from "../src/types.js";

let tmpDir: string;
let config: AppConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "okf-test-"));
  config = {
    rawDir: join(tmpDir, "raw"),
    wikiDir: join(tmpDir, "wiki"),
    rootDir: tmpDir,
    projectRoot: tmpDir,
  } as AppConfig;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── mapping ───────────────────────────────────────────────────────

describe("okf mapping", () => {
  it("kindToOkfType 映射所有 9 种 kind", () => {
    const kinds: WikiKind[] = ["concept", "claim", "method", "case", "equation", "question", "insight", "anchor", "counter"];
    for (const k of kinds) {
      expect(kindToOkfType(k)).toBeTruthy();
      expect(typeof kindToOkfType(k)).toBe("string");
    }
  });

  it("okfTypeToKind 反向映射", () => {
    expect(okfTypeToKind("Concept")).toBe("concept");
    expect(okfTypeToKind("Claim")).toBe("claim");
    expect(okfTypeToKind("unknown-type")).toBe("concept"); // fallback
  });
});

// ─── export/import ─────────────────────────────────────────────────

describe("okf export + import roundtrip", () => {
  it("空 wiki 导出成功", () => {
    mkdirSync(join(config.wikiDir, "concepts"), { recursive: true });
    const outDir = join(tmpDir, "export-out");
    const result = exportToOkf(config, outDir);
    expect(result.count).toBe(0);
  });

  it("有节点时导出并导入 roundtrip", () => {
    // 创建测试 wiki 节点
    const conceptsDir = join(config.wikiDir, "concepts");
    mkdirSync(conceptsDir, { recursive: true });

    writeFileSync(join(conceptsDir, "test-concept.md"), `---
nodeId: test/concept/alpha
kind: concept
title: Alpha
sourceIds:
  - raw/test
sourceChase:
  - raw/chase/test.md
propRefs:
  - "1"
  - "2"
confidence: 0.85
status: verified
tags:
  - math
  - test
related: []
createdAt: 2026-01-01T00:00:00Z
---
## Claim
This is a test concept about quantum computing.

## Evidence
- Evidence item 1
- Evidence item 2

## Interpretation
This is an interpretation.

## Limits
- Limit 1

## Links
- [[other-node]]
`, "utf-8");

    // 导出
    const outDir = join(tmpDir, "export-out");
    const exportResult = exportToOkf(config, outDir);
    expect(exportResult.count).toBe(1);

    // 验证导出文件存在
    const { existsSync, readFileSync } = require("node:fs");
    expect(existsSync(join(outDir, "okf-bundle", "index.md"))).toBe(true);
    expect(existsSync(join(outDir, "okf-bundle", "concepts", "index.md"))).toBe(true);
    const conceptContent = readFileSync(join(outDir, "okf-bundle", "concepts", "test-concept.md"), "utf-8");
    expect(conceptContent).toContain("type: Concept");
    expect(conceptContent).toContain("title: Alpha");
    expect(conceptContent).toContain("## Claim");

    // 导入到新 wiki
    const newWikiDir = join(tmpDir, "wiki2");
    const importConfig = { ...config, wikiDir: newWikiDir };
    mkdirSync(newWikiDir, { recursive: true });
    const importResult = importFromOkf(importConfig, join(outDir, "okf-bundle"));
    expect(importResult.imported).toBe(1);
    expect(importResult.skipped).toBe(0);
  });
});
