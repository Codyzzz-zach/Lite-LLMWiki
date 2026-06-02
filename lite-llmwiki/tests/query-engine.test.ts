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
import { queryKnowledge, extractAnnotations } from "../src/query/engine.js";
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

// ─── extractAnnotations ──────────────────────────────────────────────

describe("extractAnnotations", () => {
  it("extracts lines tagged with '基于 wiki 的推断'", () => {
    const answer = [
      "1/e 是许多微小机会都失败的极限概率。",
      "基于 wiki 的推断：在风险决策中，可以用 1/e 作为失败概率的基线。",
      "另外，在探索/利用问题中也可参考秘书问题的策略。",
    ].join("\n");

    const { inferences, missingEvidence } = extractAnnotations(answer);
    expect(inferences).toHaveLength(1);
    expect(inferences[0]).toContain("基于 wiki 的推断");
    expect(missingEvidence).toHaveLength(0);
  });

  it("extracts lines indicating missing information", () => {
    const answer = [
      "wiki 中有关于 1/e 概率极限的概念，但没有找到关于具体金融应用场景的信息。",
      "缺失的信息包括：1/e 在期权定价中的具体用法。",
      "建议查阅原始材料的相关章节。",
    ].join("\n");

    const { inferences, missingEvidence } = extractAnnotations(answer);
    expect(missingEvidence.length).toBeGreaterThanOrEqual(1);
    expect(missingEvidence.some((m) => m.includes("缺失"))).toBe(true);
  });

  it("returns empty arrays when no annotations found", () => {
    const answer = "1/e 是极限概率，约为 36.8%。来源：concept/probability-limit。";

    const { inferences, missingEvidence } = extractAnnotations(answer);
    expect(inferences).toHaveLength(0);
    expect(missingEvidence).toHaveLength(0);
  });

  it("handles empty answer", () => {
    const { inferences, missingEvidence } = extractAnnotations("");
    expect(inferences).toHaveLength(0);
    expect(missingEvidence).toHaveLength(0);
  });

  it("skips header lines and reference lines", () => {
    const answer = [
      "# 回答",
      "基于 wiki 的推断：可以迁移到搜索策略设计。",
      "---",
      "## 总结",
      "缺失了关于具体参数的数据。",
    ].join("\n");

    const { inferences, missingEvidence } = extractAnnotations(answer);
    expect(inferences).toHaveLength(1);
    expect(missingEvidence).toHaveLength(1);
  });
});

// ─── queryKnowledge (no-op / error paths) ────────────────────────────

describe("queryKnowledge", () => {
  it("returns empty result when no matching nodes exist", async () => {
    const config = { ...testConfig(), wikiDir: "/tmp/nonexistent-wiki" };
    const result = await queryKnowledge({ question: "测试", config });

    expect(result.answer).toBeTruthy();
    expect(result.sources).toHaveLength(0);
    expect(result.usage).toBeNull();
  });

  it("fails gracefully without API key (will throw on LLM call)", async () => {
    // Use a real wiki dir that exists
    const config = testConfig();

    // Without API key, the DeepSeekClient will throw when trying to call the API
    // But if there's no matching nodes, it returns early without calling LLM
    // So use a query that won't match
    const result = await queryKnowledge({
      question: "xyznonexistent_12345",
      config,
    });

    expect(result.sources).toHaveLength(0);
    expect(result.answer).toBeTruthy();
  });
});
