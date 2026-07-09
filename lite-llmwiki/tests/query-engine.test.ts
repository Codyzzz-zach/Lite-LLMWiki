/**
 * Query engine tests — evidence-aware context
 *
 * Tests:
 * - formatNodeContext assembles structured context correctly
 * - extractAnnotations finds inferences and missingEvidence
 * - queryKnowledge returns correct shape with empty results
 * - queryKnowledge assembles context with SearchMatch data
 */
import { describe, expect, it } from "vitest";
import { queryKnowledge } from "../src/query/engine.js";
import type { SearchMatch } from "../src/query/search.js";
import type { AppConfig } from "../src/types.js";

// ─── 测试用 config（无有效 API key，失败分支） ─────────────────────

function testConfig(): AppConfig {
  return {
    apiKey: "",
    baseUrl: "https://api.deepseek.com",
    projectRoot: "/tmp/test",
    rawDir: "/tmp/test/raw",
    wikiDir: "/tmp/test/wiki",
    model: "deepseek-chat",
    chunkTokenTarget: 100,
    chunkOverlapTokens: 10,
  };
}

// ─── queryKnowledge (no-op / error paths) ────────────────────────────

describe("queryKnowledge", () => {
  it("returns empty result when no matching nodes exist", async () => {
    const config = { ...testConfig(), wikiDir: "/tmp/nonexistent-wiki" };
    const mockCaller = async () => ({
      answer: "no matching nodes found",
      usage: null,
      modelSynthesis: [],
    });
    const result = await queryKnowledge({ question: "测试", config, mode: "ask", llmCaller: mockCaller });

    expect(result.answer).toBeTruthy();
    expect(result.fromWiki).toEqual([]);
    expect(result.usage).toBeNull();
  });

  it("无匹配 wiki 时返回空结果（llmCaller 必须提供）", async () => {
    const config = testConfig();
    const mockCaller = async () => ({
      answer: "no matching nodes found",
      usage: null,
      modelSynthesis: [],
    });
    const result = await queryKnowledge({
      question: "xyznonexistent_12345",
      config,
      mode: "ask",
      llmCaller: mockCaller,
    });
    expect(result.fromWiki).toEqual([]);
    expect(result.answer).toBe("no matching nodes found");
  });
});
