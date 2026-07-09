/**
 * v6 render — render.ts 的 v6 行为单测
 *
 * 覆盖：
 * - D1: WikiNodeDraft 支持 auditNotes / boardUse 字段
 * - R1: render 输出 `## Audit Notes` 与 `## Board Use` sections
 * - R1: render 把 v6 frontmatter 字段写回（auditStatus / boardRoles / claimType / ...）
 * - B1: v6 节点不再由 render 自动推断 status
 * - Roundtrip: draft → render → parse → 与原 draft 等价
 */
import { describe, expect, it } from "vitest";
import { parseWikiContent } from "../src/knowledge/wiki-parser.js";
import { renderWikiNode } from "../src/knowledge/render.js";
import type { WikiNodeDraft } from "../src/types.js";

function makeDraft(overrides: Partial<WikiNodeDraft> = {}): WikiNodeDraft {
  return {
    nodeId: "test/concept/roundtrip",
    kind: "concept",
    filePath: "wiki/concepts/test-concept.md",
    frontmatter: {
      title: "Roundtrip test",
      nodeId: "test/concept/roundtrip",
      kind: "concept",
      sourceIds: ["raw_pdf_test-abcd"],
      sourceChase: ["raw/chase/raw_pdf_test-abcd.md"],
      propRefs: ["1", "2"],
      confidence: 0.85,
      status: "verified",
      tags: ["math", "test"],
      related: [],
    },
    claim: "This is the claim.",
    evidence: [{
      sourceId: "raw_pdf_test-abcd",
      propRefs: ["1", "2"],
      summary: "Test summary.",
      excerpt: "Test excerpt.",
    }],
    interpretation: "This is interpretation.",
    useFor: ["use-for-1", "use-for-2"],
    limits: ["limit-1"],
    links: ["link-1"],
    ...overrides,
  };
}

describe("v6 render — WikiNodeDraft v6 sections (D1)", () => {
  it("WikiNodeDraft 接受 auditNotes 字段", () => {
    const draft = makeDraft({ auditNotes: "v6 audit review note" });
    const md = renderWikiNode(draft);
    expect(md).toContain("## Audit Notes");
    expect(md).toContain("v6 audit review note");
  });

  it("WikiNodeDraft 接受 boardUse 字段", () => {
    const draft = makeDraft({ boardUse: ["作为 ask 模式证据", "作为 challenge 限制条件"] });
    const md = renderWikiNode(draft);
    expect(md).toContain("## Board Use");
    expect(md).toContain("- 作为 ask 模式证据");
    expect(md).toContain("- 作为 challenge 限制条件");
  });

  it("auditNotes 为空时不输出该 section", () => {
    const draft = makeDraft({ auditNotes: "" });
    const md = renderWikiNode(draft);
    expect(md).not.toContain("## Audit Notes");
  });

  it("boardUse 为空数组时不输出该 section", () => {
    const draft = makeDraft({ boardUse: [] });
    const md = renderWikiNode(draft);
    expect(md).not.toContain("## Board Use");
  });
});

describe("v6 render — 输出 v6 frontmatter 字段 (R1)", () => {
  it("auditStatus 字段写回 frontmatter", () => {
    const draft = makeDraft({
      frontmatter: {
        ...makeDraft().frontmatter,
        auditStatus: "passed",
        auditScore: 0.92,
      },
    });
    const md = renderWikiNode(draft);
    expect(md).toMatch(/^auditStatus: passed$/m);
    expect(md).toMatch(/^auditScore: 0\.92$/m);
  });

  it("claimType / inferenceLevel 写回 frontmatter", () => {
    const draft = makeDraft({
      frontmatter: {
        ...makeDraft().frontmatter,
        claimType: "source_claim",
        inferenceLevel: "none",
      },
    });
    const md = renderWikiNode(draft);
    expect(md).toMatch(/^claimType: source_claim$/m);
    expect(md).toMatch(/^inferenceLevel: none$/m);
  });

  it("boardRoles 数组写回 frontmatter", () => {
    const draft = makeDraft({
      frontmatter: {
        ...makeDraft().frontmatter,
        boardRoles: ["evidence", "concept"],
      },
    });
    const md = renderWikiNode(draft);
    expect(md).toMatch(/^boardRoles:/m);
    expect(md).toMatch(/^\s+- evidence$/m);
    expect(md).toMatch(/^\s+- concept$/m);
  });

  it("propRefs / claimHash 写回 frontmatter", () => {
    const draft = makeDraft({
      frontmatter: {
        ...makeDraft().frontmatter,
        propRefs: ["prop-1", "prop-2"],
        claimHash: "abc123def456",
      },
    });
    const md = renderWikiNode(draft);
    expect(md).toMatch(/^claimHash: abc123def456$/m);
    expect(md).toMatch(/^propRefs:/m);
    expect(md).toMatch(/^\s+- prop-1$/m);
  });
});

describe("v6 render — status 不再自动推断 (B1)", () => {
  it("显式声明 status 时原样保留", () => {
    const draft = makeDraft({
      frontmatter: { ...makeDraft().frontmatter, status: "needs_review" },
    });
    const md = renderWikiNode(draft);
    expect(md).toMatch(/^status: needs_review$/m);
  });

  it("未声明 status 时不再自动推断为 verified", () => {
    // 旧实现：缺 status 时若 evidence/sourceChase/propRefs 都有则自动 verified
    // 新行为（B1）：render 不再自动推断为 verified
    const fm = { ...makeDraft().frontmatter };
    delete (fm as Record<string, unknown>).status;
    const draft = makeDraft({ frontmatter: fm });
    const md = renderWikiNode(draft);
    expect(md).not.toMatch(/^status: verified$/m);
  });

  it("v6 节点（带 auditStatus）显式声明 status 时原样保留", () => {
    const draft = makeDraft({
      frontmatter: {
        ...makeDraft().frontmatter,
        status: "needs_review",
        auditStatus: "pending",
      },
    });
    const md = renderWikiNode(draft);
    expect(md).toMatch(/^auditStatus: pending$/m);
    expect(md).toMatch(/^status: needs_review$/m);
  });
});

describe("v6 render — Draft → Markdown → Parse 回环", () => {
  it("v6 draft roundtrip 保留 auditNotes / boardUse", () => {
    const original = makeDraft({
      auditNotes: "Reviewed by semantic audit on 2026-06-05",
      boardUse: ["ask 模式主证据", "challenge 模式限制"],
      frontmatter: {
        ...makeDraft().frontmatter,
        auditStatus: "passed",
        auditScore: 0.9,
        claimType: "source_claim",
        inferenceLevel: "none",
        boardRoles: ["evidence", "concept"],
        propRefs: ["prop-1"],
        claimHash: "hash-abc",
      },
    });
    const md = renderWikiNode(original);
    const parsed = parseWikiContent(md, original.filePath);

    // 节点身份
    expect(parsed.nodeId).toBe(original.nodeId);
    expect(parsed.kind).toBe(original.kind);
    expect(parsed.title).toBe(original.frontmatter.title);

    // 章节
    expect(parsed.sections.auditNotes).toContain("Reviewed by semantic audit on 2026-06-05");
    expect(parsed.sections.boardUse).toEqual(["ask 模式主证据", "challenge 模式限制"]);

    // v6 字段
    expect(parsed.frontmatter.auditStatus).toBe("passed");
    expect(parsed.frontmatter.auditScore).toBe(0.9);
    expect(parsed.frontmatter.claimType).toBe("source_claim");
    expect(parsed.frontmatter.inferenceLevel).toBe("none");
    expect(parsed.frontmatter.boardRoles).toEqual(["evidence", "concept"]);
    expect(parsed.frontmatter.propRefs).toEqual(["prop-1", "1", "2"]);
    expect(parsed.frontmatter.claimHash).toBe("hash-abc");
  });

  it("未填 v6 字段的 v5 draft roundtrip 不报错", () => {
    const original = makeDraft(); // 全 v5
    const md = renderWikiNode(original);
    const parsed = parseWikiContent(md, original.filePath);
    expect(parsed.nodeId).toBe(original.nodeId);
    expect(parsed.sections.auditNotes).toBe("");
    expect(parsed.sections.boardUse).toEqual([]);
  });
});
