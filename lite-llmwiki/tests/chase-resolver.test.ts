/**
 * chase — 清洗层解析与读取单测
 *
 * 覆盖：
 * - H1: 兼容 v5 冒号格式 + v6 空格格式
 * - H2: 缺失文件抛 ChaseNotFoundError
 * - H3: selectChaseChunks 报告 missing refs
 * - M1: resolveChasePath 路径不重复
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ChaseNotFoundError,
  collectChunkIndices,
  getExcerpt,
  readChaseChunks,
  resolveChasePath,
  selectChaseChunks,
} from "../src/knowledge/chase.js";
import type { AppConfig } from "../src/types.js";

let tmpDir: string;
let config: AppConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "chase-test-"));
  config = {
    rawDir: tmpDir,
    wikiDir: join(tmpDir, "wiki"),
    rootDir: tmpDir,
  } as AppConfig;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("chase — marker 格式兼容 (H1)", () => {
  it("v5 冒号格式 `<!-- chunk:N -->`", () => {
    const content = "<!-- chunk:1 -->\nFirst.\n<!-- chunk:2 -->\nSecond.\n";
    expect([...collectChunkIndices(content)]).toEqual([1, 2]);
  });

  it("v6 空格格式 `<!-- chunk N -->`", () => {
    const content = "<!-- chunk 1 -->\nFirst.\n<!-- chunk 2 -->\nSecond.\n";
    expect([...collectChunkIndices(content)]).toEqual([1, 2]);
  });

  it("v5 冒号带后缀 `<!-- chunk:N foo -->`", () => {
    const content = "<!-- chunk:1 foo -->\nFirst.\n";
    expect([...collectChunkIndices(content)]).toEqual([1]);
  });

  it("混合 v5 + v6 标记同一文件", () => {
    const content = "<!-- chunk:1 -->\nA\n<!-- chunk 2 -->\nB\n";
    expect([...collectChunkIndices(content)]).toEqual([1, 2]);
  });

  it("无 marker 时 collectChunkIndices 返回空集", () => {
    const content = "just plain text\nno markers\n";
    expect([...collectChunkIndices(content)]).toEqual([]);
  });

  it("readChaseChunks 按 marker 切分", () => {
    const dir = join(tmpDir, "chase");
    require("node:fs").mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "x.md"),
      "<!-- chunk 1 -->\nFirst content.\n<!-- chunk 2 -->\nSecond content.\n",
    );
    const chunks = readChaseChunks(config, ["x.md"]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.index).toBe(1);
    expect(chunks[0]?.text).toBe("First content.");
    expect(chunks[1]?.index).toBe(2);
    expect(chunks[1]?.text).toBe("Second content.");
  });
});

describe("chase — 错误处理 (H2)", () => {
  it("chase 文件不存在抛 ChaseNotFoundError", () => {
    expect(() => readChaseChunks(config, ["missing.md"])).toThrow(ChaseNotFoundError);
  });

  it("sourceChase 为空返回 null", () => {
    expect(resolveChasePath(config, [])).toBeNull();
  });

  it("所有候选路径都不存在返回 null", () => {
    expect(resolveChasePath(config, ["nope1.md", "nope2.md"])).toBeNull();
  });
});

describe("chase — selectChaseChunks 报告 missing (H3)", () => {
  it("命中与未命中分开返回", () => {
    const dir = join(tmpDir, "chase");
    require("node:fs").mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "x.md"),
      "<!-- chunk 1 -->\nFirst.\n<!-- chunk 2 -->\nSecond.\n<!-- chunk 3 -->\nThird.\n",
    );
    const r = selectChaseChunks(config, ["x.md"], [1, 99, 3]);
    expect(r.found.map((c) => c.index)).toEqual([1, 3]);
    expect(r.missing).toEqual([99]);
  });

  it("全部命中时 missing 为空", () => {
    const dir = join(tmpDir, "chase");
    require("node:fs").mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "x.md"), "<!-- chunk 1 -->\nA\n<!-- chunk 2 -->\nB\n");
    const r = selectChaseChunks(config, ["x.md"], [1, 2]);
    expect(r.found).toHaveLength(2);
    expect(r.missing).toEqual([]);
  });

  it("全部未命中时 found 为空", () => {
    const dir = join(tmpDir, "chase");
    require("node:fs").mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "x.md"), "<!-- chunk 1 -->\nA\n");
    const r = selectChaseChunks(config, ["x.md"], [99, 100]);
    expect(r.found).toEqual([]);
    expect(r.missing).toEqual([99, 100]);
  });
});

describe("chase — getExcerpt (返回 text 摘要)", () => {
  it("返回命中 chunk 的 (index, text) 列表", () => {
    const dir = join(tmpDir, "chase");
    require("node:fs").mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "x.md"),
      "<!-- chunk 1 -->\nFirst text.\n<!-- chunk 2 -->\nSecond text.\n",
    );
    const r = getExcerpt(config, ["x.md"], [1, 2]);
    expect(r).toEqual([
      { index: 1, text: "First text." },
      { index: 2, text: "Second text." },
    ]);
  });
});

describe("chase — resolveChasePath 路径不重复 (M1)", () => {
  it("相对路径直接 join rawDir/chase", () => {
    const dir = join(tmpDir, "chase");
    require("node:fs").mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "foo.md"), "x");
    expect(resolveChasePath(config, ["foo.md"])).toBe(join(dir, "foo.md"));
  });

  it("绝对路径直接返回", () => {
    const absPath = join(tmpDir, "abs.md");
    writeFileSync(absPath, "x");
    expect(resolveChasePath(config, [absPath])).toBe(absPath);
  });
});
