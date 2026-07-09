/**
 * proposition — 命题提取单测
 *
 * 覆盖：
 * - extractPropositions: LLM 响应解析
 * - insertPropMarkers: marker 插入逻辑
 * - readChaseProps: prop marker 解析
 * - 边界：空内容、无 chunk marker、LLM 返回非 JSON
 */
import { describe, expect, it, vi } from "vitest";
import { extractPropositions } from "../src/ingest/proposition.js";
import { readChaseProps } from "../src/knowledge/chase.js";
import type { AppConfig } from "../src/types.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

let tmpDir: string;
let config: AppConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "prop-test-"));
  config = {
    rawDir: tmpDir,
    wikiDir: join(tmpDir, "wiki"),
    rootDir: tmpDir,
  } as AppConfig;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function setupChaseFile(name: string, content: string) {
  const dir = join(config.rawDir, "chase");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content, "utf-8");
}

describe("extractPropositions", () => {
  const chaseContent = `<!-- chunk 1 -->
量子计算利用量子比特的叠加态进行并行计算。

<!-- chunk 2 -->
与传统计算不同，量子比特可以同时处于0和1的叠加态。
这种特性使得量子计算在某些问题上具有指数级加速优势。`;

  it("正确解析 LLM 返回的命题 JSON", async () => {
    const mockLlm = vi.fn(async () => JSON.stringify([
      { index: 1, text: "量子计算利用量子比特的叠加态进行并行计算。", chunkIndex: 1 },
      { index: 2, text: "与传统计算不同，量子比特可以同时处于0和1的叠加态。", chunkIndex: 2 },
      { index: 3, text: "这种特性使得量子计算在某些问题上具有指数级加速优势。", chunkIndex: 2 },
    ]));

    const result = await extractPropositions(chaseContent, mockLlm);

    expect(result.props).toHaveLength(3);
    expect(result.props[0]!.text).toContain("量子计算利用量子比特");
    expect(result.props[0]!.index).toBe(1);
    expect(result.props[0]!.marker).toBe("<!-- prop 1 -->");
  });

  it("在 chase 内容中插入 prop marker", async () => {
    const mockLlm = vi.fn(async () => JSON.stringify([
      { index: 1, text: "量子计算利用量子比特的叠加态进行并行计算。", chunkIndex: 1 },
    ]));

    const result = await extractPropositions(chaseContent, mockLlm);

    expect(result.updatedContent).toContain("<!-- prop 1 -->");
    expect(result.updatedContent).toContain("量子计算利用量子比特");
  });

  it("LLM 返回非 JSON 时抛错", async () => {
    const mockLlm = vi.fn(async () => "这不是 JSON");

    await expect(extractPropositions(chaseContent, mockLlm)).rejects.toThrow(
      "Failed to parse proposition LLM response",
    );
  });

  it("LLM 返回空数组时抛错", async () => {
    const mockLlm = vi.fn(async () => "[]");

    await expect(extractPropositions(chaseContent, mockLlm)).rejects.toThrow(
      "No valid propositions found",
    );
  });

  it("LLM 返回带 markdown 代码块的 JSON 能正确清理", async () => {
    const mockLlm = vi.fn(async () => "```json\n" + JSON.stringify([
      { index: 1, text: "量子计算利用量子比特的叠加态进行并行计算。", chunkIndex: 1 },
    ]) + "\n```");

    const result = await extractPropositions(chaseContent, mockLlm);

    expect(result.props).toHaveLength(1);
    expect(result.props[0]!.text).toContain("量子计算利用量子比特");
  });
});

describe("readChaseProps", () => {
  it("正确解析 prop marker", () => {
    const content = `<!-- chunk 1 -->
普通文本

<!-- prop 1 -->
第一个命题：量子计算利用叠加态。

<!-- prop 2 -->
第二个命题：叠加态是量子计算的核心。

<!-- chunk 2 -->
更多内容

<!-- prop 3 -->
第三个命题。`;

    setupChaseFile("test.md", content);
    const props = readChaseProps(config, ["test.md"]);

    expect(props).toHaveLength(3);
    expect(props[0]!.index).toBe(1);
    expect(props[0]!.text).toContain("第一个命题");
    expect(props[1]!.index).toBe(2);
    expect(props[1]!.text).toContain("第二个命题");
    expect(props[2]!.index).toBe(3);
    expect(props[2]!.text).toContain("第三个命题");
  });

  it("没有 prop marker 时返回空数组", () => {
    const content = `<!-- chunk 1 -->
只有 chunk marker，没有 prop marker。`;

    setupChaseFile("no-prop.md", content);
    const props = readChaseProps(config, ["no-prop.md"]);

    expect(props).toEqual([]);
  });

  it("chase 文件不存在时返回空数组", () => {
    const props = readChaseProps(config, ["nonexistent.md"]);
    expect(props).toEqual([]);
  });

  it("prop marker 中的命题文本不含相邻 marker", () => {
    const content = `<!-- prop 1 -->命题一<!-- prop 2 -->命题二`;

    setupChaseFile("adjacent.md", content);
    const props = readChaseProps(config, ["adjacent.md"]);

    expect(props).toHaveLength(2);
    expect(props[0]!.text).toBe("命题一");
    expect(props[0]!.marker).toBe("<!-- prop 1 -->");
    expect(props[1]!.text).toBe("命题二");
  });
});
