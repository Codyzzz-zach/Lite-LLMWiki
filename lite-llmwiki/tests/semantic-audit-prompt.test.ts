/**
 * semantic-audit-prompt — prompt builder + response parser 单测
 *
 * 覆盖（plan 7.4 + 7.5）：
 * - buildSemanticAuditInput  从 ParsedWikiNode + chase excerpts 构造输入
 * - buildSemanticAuditPrompt  含 claim / evidence / interpretation / limits / chase excerpts
 * - parseSemanticAuditResponse  严格 JSON 解析；解析失败抛错
 * - 输入缺失/异常时返回合理默认（如缺失 chase → issues 标注）
 */
import { describe, expect, it } from "vitest";
import { parseWikiContent } from "../src/knowledge/wiki-parser.js";
import {
  buildSemanticAuditInput,
  buildSemanticAuditPrompt,
  parseSemanticAuditResponse,
  type SemanticAuditInput,
} from "../src/knowledge/semantic-audit-prompt.js";

function makeInput(overrides: Partial<SemanticAuditInput> = {}): SemanticAuditInput {
  return {
    nodeId: "test/concept/x",
    filePath: "wiki/concepts/test-x.md",
    title: "Test node",
    kind: "concept",
    frontmatter: {
      title: "Test node",
      nodeId: "test/concept/x",
      kind: "concept",
      auditStatus: "pending",
    },
    claim: "This is the claim.",
    evidence: ["Source A says X", "Source B says Y"],
    interpretation: "Therefore Z.",
    limits: ["Only tested in lab"],
    sourceChase: ["raw/chase/test.md"],
    chunkRefs: [1, 2],
    chaseExcerpts: [
      { index: 1, text: "Original text for chunk 1..." },
      { index: 2, text: "Original text for chunk 2..." },
    ],
    ...overrides,
  };
}

describe("semantic-audit-prompt — buildSemanticAuditInput", () => {
  it("从 ParsedWikiNode + chase excerpts 构造完整输入", () => {
    const node = parseWikiContent(
      [
        "---",
        "nodeId: test/concept/x",
        "kind: concept",
        "title: Test",
        "auditStatus: pending",
        "---",
        "",
        "## Claim",
        "C",
        "",
        "## Evidence",
        "- e1",
        "- e2",
        "",
        "## Interpretation",
        "I",
        "",
        "## Limits",
        "- l1",
        "",
      ].join("\n"),
      "wiki/concepts/test-x.md",
    );
    const excerpts = [
      { index: 1, text: "chase text 1" },
      { index: 2, text: "chase text 2" },
    ];
    const input = buildSemanticAuditInput(node, excerpts);
    expect(input.nodeId).toBe("test/concept/x");
    expect(input.title).toBe("Test");
    expect(input.kind).toBe("concept");
    expect(input.claim).toBe("C");
    expect(input.evidence).toEqual(["e1", "e2"]);
    expect(input.interpretation).toBe("I");
    expect(input.limits).toEqual(["l1"]);
    expect(input.chaseExcerpts).toEqual(excerpts);
    expect(input.frontmatter.auditStatus).toBe("pending");
  });
});

describe("semantic-audit-prompt — buildSemanticAuditPrompt", () => {
  it("prompt 包含 node 身份信息", () => {
    const prompt = buildSemanticAuditPrompt(makeInput());
    expect(prompt).toContain("test/concept/x");
    expect(prompt).toContain("Test node");
    expect(prompt).toContain("concept");
  });

  it("prompt 包含 Claim / Evidence / Interpretation / Limits 章节", () => {
    const prompt = buildSemanticAuditPrompt(makeInput());
    expect(prompt).toContain("## Claim");
    expect(prompt).toContain("This is the claim.");
    expect(prompt).toContain("## Evidence");
    expect(prompt).toContain("Source A says X");
    expect(prompt).toContain("Source B says Y");
    expect(prompt).toContain("## Interpretation");
    expect(prompt).toContain("Therefore Z.");
    expect(prompt).toContain("## Limits");
    expect(prompt).toContain("Only tested in lab");
  });

  it("prompt 包含 chase excerpts（按 chunk 编号）", () => {
    const prompt = buildSemanticAuditPrompt(makeInput());
    expect(prompt).toContain("[Chunk 1]");
    expect(prompt).toContain("Original text for chunk 1...");
    expect(prompt).toContain("[Chunk 2]");
    expect(prompt).toContain("Original text for chunk 2...");
  });

  it("prompt 包含审查维度说明（spec 7.2）", () => {
    const prompt = buildSemanticAuditPrompt(makeInput());
    expect(prompt.toLowerCase()).toContain("support");
    expect(prompt.toLowerCase()).toContain("addition");
    expect(prompt.toLowerCase()).toContain("inference");
    expect(prompt.toLowerCase()).toContain("limits");
    expect(prompt.toLowerCase()).toContain("citation");
  });

  it("prompt 要求 JSON-only 输出", () => {
    const prompt = buildSemanticAuditPrompt(makeInput());
    expect(prompt).toMatch(/json[- ]only|输出\s*json/i);
  });

  it("chase excerpts 为空时显式标注（spec 7.7 缺失 → error）", () => {
    const prompt = buildSemanticAuditPrompt(makeInput({ chaseExcerpts: [] }));
    expect(prompt).toMatch(/no chase excerpt|chase\s*缺失|missing\s*chase/i);
  });

  it("chunkRefs 为空时显式标注（spec 7.7）", () => {
    const prompt = buildSemanticAuditPrompt(makeInput({ chunkRefs: [] }));
    expect(prompt).toMatch(/missing\s*chunkrefs|chunkref\s*缺失|no\s*chunk/i);
  });
});

describe("semantic-audit-prompt — parseSemanticAuditResponse", () => {
  it("解析严格 JSON", () => {
    const text = JSON.stringify({
      nodeId: "test/concept/x",
      verdict: "passed",
      score: 0.92,
      support: "aligned",
      addition: "none",
      inference: "ok",
      limits: "ok",
      citation: "ok",
      issues: [],
    });
    const v = parseSemanticAuditResponse(text, "test/concept/x");
    expect(v.verdict).toBe("passed");
    expect(v.score).toBe(0.92);
    expect(v.support).toBe("aligned");
    expect(v.addition).toBe("none");
    expect(v.inference).toBe("ok");
    expect(v.limits).toBe("ok");
    expect(v.citation).toBe("ok");
    expect(v.issues).toEqual([]);
  });

  it("LLM 输出被 ```json ... ``` 包裹时仍能解析", () => {
    const text = [
      "```json",
      JSON.stringify({
        nodeId: "test/concept/x",
        verdict: "warning",
        score: 0.7,
        support: "stretched",
        addition: "minor",
        inference: "warning",
        limits: "ok",
        citation: "ok",
        issues: ["claim 有点扩张"],
      }),
      "```",
    ].join("\n");
    const v = parseSemanticAuditResponse(text, "test/concept/x");
    expect(v.verdict).toBe("warning");
    expect(v.support).toBe("stretched");
    expect(v.issues).toEqual(["claim 有点扩张"]);
  });

  it("JSON 解析失败抛错（spec 7.7 错误策略）", () => {
    expect(() => parseSemanticAuditResponse("not json", "test/x")).toThrow();
  });

  it("verdict 非法值抛错", () => {
    const text = JSON.stringify({
      nodeId: "test/x",
      verdict: "bogus",
      score: 0.5,
      support: "aligned",
      addition: "none",
      inference: "ok",
      limits: "ok",
      citation: "ok",
      issues: [],
    });
    expect(() => parseSemanticAuditResponse(text, "test/x")).toThrow();
  });

  it("score 缺失/非法抛错", () => {
    const text = JSON.stringify({
      nodeId: "test/x",
      verdict: "passed",
      support: "aligned",
      addition: "none",
      inference: "ok",
      limits: "ok",
      citation: "ok",
      issues: [],
    });
    expect(() => parseSemanticAuditResponse(text, "test/x")).toThrow();
  });

  it("解析时强制 nodeId 与输入一致（防止 LLM 错配）", () => {
    const text = JSON.stringify({
      nodeId: "different-node",
      verdict: "passed",
      score: 0.9,
      support: "aligned",
      addition: "none",
      inference: "ok",
      limits: "ok",
      citation: "ok",
      issues: [],
    });
    const v = parseSemanticAuditResponse(text, "test/concept/x");
    expect(v.nodeId).toBe("test/concept/x"); // 覆盖 LLM 错配
  });
});
