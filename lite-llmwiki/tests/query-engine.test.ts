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
    const result = await queryKnowledge({ question: "测试", config });

    expect(result.answer).toBeTruthy();
    expect(result.fromWiki).toEqual([]);
    expect(result.usage).toBeNull();
  });

  it("无 API key + 无匹配 wiki → board-only 模式（不调 LLM，不 throw）", async () => {
    const config = testConfig();
    const result = await queryKnowledge({
      question: "xyznonexistent_12345",
      config,
    });
    expect(result.fromWiki).toEqual([]);
    expect(result.answer).toBeTruthy();
    expect(result.answer).toMatch(/no api key|board-only/i);
  });
});
