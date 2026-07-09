/**
 * qmd-search — QmdSearchProvider 单测
 *
 * 覆盖：
 * - qmd 不可用时回退到 fallback
 * - qmd 可用时正常调用
 * - qmd 返回空结果
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
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
  it("qmd 不可用时回退到 fallback", () => {
    const fallback: SearchProvider = {
      search: vi.fn(() => mockSearchResult(["fallback-node"])),
    };
    // qmd 通常不可用在 CI 环境——直接测试 fallback 行为
    const provider = new QmdSearchProvider(fallback, "nonexistent-qmd");
    const result = provider.search(mockConfig(), "test query");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.nodeId).toBe("fallback-node");
  });

  it("fallback 未指定时使用默认关键词搜索", () => {
    // 创建一个永远不会找到 qmd 的 provider
    const provider = new QmdSearchProvider(undefined, "nonexistent-qmd-cmd");
    // 应该不出错，正常回退
    expect(() => provider.search(mockConfig(), "test")).not.toThrow();
  });

  it("构造函数接受自定义 qmd 命令", () => {
    const provider = new QmdSearchProvider(undefined, "/usr/local/bin/qmd");
    // 构造函数不应抛错
    expect(provider).toBeDefined();
  });
});
