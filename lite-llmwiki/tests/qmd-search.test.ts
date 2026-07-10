/**
 * qmd-search — QmdSearchProvider 单测
 *
 * 覆盖：
 * - qmd 不可用时回退到 fallback（search 同步、searchLex/searchVector 异步均回退）
 * - fallback 未指定时使用默认关键词搜索
 * - searchVector 异步路径在 qmd 不可用时回退
 *
 * v2: 构造函数只接受 fallback 一个参数（旧测试多传的 qmd 命令字符串已移除）。
 *     searchLex/searchVector 改为 async（供三路 RRF 融合）。
 */
import { describe, expect, it, vi } from "vitest";
import { QmdSearchProvider } from "../src/query/qmd-search.js";
import type { SearchProvider, SearchResult } from "../src/query/search-provider.js";
import type { AppConfig } from "../src/types.js";

function mockConfig(): AppConfig {
  return { wikiDir: "/tmp/wiki", rawDir: "/tmp/raw", projectRoot: "/tmp", apiKey: "", baseUrl: "", model: "", chunkTokenTarget: 0, chunkOverlapTokens: 0 };
}

function mockSearchResult(matches: string[]): SearchResult {
  return {
    matches: matches.map((nodeId) => ({
      nodeId,
      kind: "concept",
      title: nodeId,
      score: 0.5,
      filePath: `wiki/concepts/${nodeId}.md`,
      claim: "",
      evidence: [],
      interpretation: "",
      limits: [],
      useFor: [],
      sourceIds: [],
      sourceChase: [],
      propRefs: [],
      related: [],
      tags: [],
    })),
  };
}

describe("QmdSearchProvider", () => {
  it("qmd 不可用时 search() 回退到 fallback", () => {
    const fallback: SearchProvider = {
      search: vi.fn(() => mockSearchResult(["fallback-node"])),
    };
    // qmd 不可用在 CI 环境（无 .qmd/store.sqlite）——直接测 fallback 行为
    const provider = new QmdSearchProvider(fallback);
    const result = provider.search(mockConfig(), "test query");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.nodeId).toBe("fallback-node");
  });

  it("fallback 未指定时使用默认关键词搜索", () => {
    // 不会找到 qmd store——应回退到内置 keyword 搜索，不抛错
    const provider = new QmdSearchProvider(undefined);
    expect(() => provider.search(mockConfig(), "test")).not.toThrow();
  });

  it("searchVector qmd 不可用时返回空（不 fallback keyword，Finding 4）", async () => {
    const fallback: SearchProvider = {
      search: vi.fn(() => mockSearchResult(["vec-fallback"])),
    };
    const provider = new QmdSearchProvider(fallback);
    // qmd store 不存在 → searchVector 返空（不 fallback keyword）
    // 保证 board 三路 RRF 的 Vector 路为空→贡献 0（降级正确）
    const result = await provider.searchVector(mockConfig(), "test query");
    expect(result.matches).toHaveLength(0);
    // fallback.search 不该被调用（Vector 路不该 fallback）
    expect(fallback.search).not.toHaveBeenCalled();
  });

  it("searchLex qmd 不可用时返回空（不 fallback keyword，Finding 4）", async () => {
    const fallback: SearchProvider = {
      search: vi.fn(() => mockSearchResult(["lex-fallback"])),
    };
    const provider = new QmdSearchProvider(fallback);
    const result = await provider.searchLex(mockConfig(), "test query");
    expect(result.matches).toHaveLength(0);
    expect(fallback.search).not.toHaveBeenCalled();
  });
});
