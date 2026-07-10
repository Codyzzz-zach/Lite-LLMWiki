/**
 * wiki-parser — 共享解析器单测
 *
 * 覆盖：
 * - C1: WikiKind 单复数不匹配（singular output）
 * - C3: confidence / auditScore 类型归一化（string → number）
 * - C4: tags 字符串按逗号拆 / 数组直通
 * - H5: evidence 处理 `-` 和 `>` 块引用
 * - M2: 引号值自动剥引号
 * - M9: parseStringList / parseChunkRefs / extractRawId / scalar 工具
 * - 共享工具：splitLines / normalizeFrontmatter
 */
import { describe, expect, it } from "vitest";
import {
  extractRawId,
  inferKindFromPath,
  parseChunkRefs,
  parseStringList,
  parseWikiContent,
  scalar,
} from "../src/knowledge/wiki-parser.js";

describe("wiki-parser — WikiKind 归一化 (C1)", () => {
  it("legacy 页面（无 nodeId）按目录推断为 singular kind", () => {
    const r = parseWikiContent(
      "---\ntitle: legacy\n---\n## Claim\nx\n",
      "wiki/concepts/legacy.md",
    );
    expect(r.kind).toBe("concept");
    expect(r.isLegacy).toBe(true);
  });

  it("frontmatter 中 kind: claim 保留为 singular", () => {
    const r = parseWikiContent(
      "---\nnodeId: x\nkind: claim\ntitle: x\n---\n## Claim\nx\n",
      "wiki/concepts/x.md",
    );
    expect(r.kind).toBe("claim");
  });

  it("frontmatter 中 kind: insight 不被静默改成 concept", () => {
    const r = parseWikiContent(
      "---\nnodeId: i\nkind: insight\ntitle: i\n---\n## Claim\nx\n",
      "wiki/insights/i.md",
    );
    expect(r.kind).toBe("insight");
  });

  it("frontmatter 中 kind 为非法值时回退到 concept", () => {
    const r = parseWikiContent(
      "---\nnodeId: b\nkind: boguskind\ntitle: b\n---\n## Claim\nx\n",
      "wiki/concepts/b.md",
    );
    expect(r.kind).toBe("concept");
  });

  it("inferKindFromPath 全部 8 个目录返回 singular", () => {
    for (const [dir, kind] of [
      ["concepts", "concept"],
      ["methods", "method"],
      ["cases", "case"],
      ["equations", "equation"],
      ["questions", "question"],
      ["insights", "insight"],
      ["anchors", "anchor"],
      ["counters", "counter"],
    ] as const) {
      expect(inferKindFromPath(`wiki/${dir}/foo.md`)).toBe(kind);
    }
  });

  it("inferKindFromPath 对未知目录回退到 concept", () => {
    expect(inferKindFromPath("wiki/random/foo.md")).toBe("concept");
  });
});

describe("wiki-parser — frontmatter 类型归一化 (C3)", () => {
  it("confidence 由 string 归一为 number", () => {
    const r = parseWikiContent(
      "---\nnodeId: c\nkind: concept\ntitle: c\nconfidence: 0.9\n---\n## Claim\nx\n",
      "wiki/concepts/c.md",
    );
    expect(r.frontmatter.confidence).toBe(0.9);
    expect(typeof r.frontmatter.confidence).toBe("number");
  });

  it("auditScore 由 string 归一为 number", () => {
    const r = parseWikiContent(
      "---\nnodeId: a\nkind: concept\ntitle: a\nauditScore: 0.85\n---\n## Claim\nx\n",
      "wiki/concepts/a.md",
    );
    expect(r.frontmatter.auditScore).toBe(0.85);
  });

  it("未提供 confidence/auditScore 时保持 undefined", () => {
    const r = parseWikiContent(
      "---\nnodeId: n\nkind: concept\ntitle: n\n---\n## Claim\nx\n",
      "wiki/concepts/n.md",
    );
    expect(r.frontmatter.confidence).toBeUndefined();
    expect(r.frontmatter.auditScore).toBeUndefined();
  });

  it("v6: chunkRefs 不再合并到 propRefs（设计决策 #1）", () => {
    const r = parseWikiContent(
      "---\nnodeId: r\nkind: concept\ntitle: r\nchunkRefs: [1, 2, 3]\n---\n## Claim\nx\n",
      "wiki/concepts/r.md",
    );
    // v6: chunkRefs 不再作为 propRefs 来源——旧数据保留但不合并
    expect(r.frontmatter.propRefs).toBeUndefined();
  });
});

describe("wiki-parser — tags 归一化 (C4)", () => {
  it("tags 字符串按逗号拆分", () => {
    const r = parseWikiContent(
      "---\nnodeId: t1\nkind: concept\ntitle: t1\ntags: math, science, deep\n---\n## Claim\nx\n",
      "wiki/concepts/t1.md",
    );
    expect(r.frontmatter.tags).toEqual(["math", "science", "deep"]);
  });

  it("tags 数组原样保留", () => {
    const r = parseWikiContent(
      "---\nnodeId: t2\nkind: concept\ntitle: t2\ntags:\n  - math\n  - science\n---\n## Claim\nx\n",
      "wiki/concepts/t2.md",
    );
    expect(r.frontmatter.tags).toEqual(["math", "science"]);
  });

  it("无 tags 时保持 undefined", () => {
    const r = parseWikiContent(
      "---\nnodeId: t3\nkind: concept\ntitle: t3\n---\n## Claim\nx\n",
      "wiki/concepts/t3.md",
    );
    expect(r.frontmatter.tags).toBeUndefined();
  });
});

describe("wiki-parser — section 抽取 (H5)", () => {
  it("evidence 抽取 `-` bullets", () => {
    const r = parseWikiContent(
      "---\nnodeId: e\nkind: concept\ntitle: e\n---\n## Evidence\n\n- bullet one\n- bullet two\n",
      "wiki/concepts/e.md",
    );
    expect(r.sections.evidence).toEqual(["bullet one", "bullet two"]);
  });

  it("evidence 抽取 `>` 块引用", () => {
    const r = parseWikiContent(
      "---\nnodeId: q\nkind: concept\ntitle: q\n---\n## Evidence\n\n> quote one\n> quote two\n",
      "wiki/concepts/q.md",
    );
    expect(r.sections.evidence).toEqual(["quote one", "quote two"]);
  });

  it("evidence 混合 bullet + 块引用", () => {
    const r = parseWikiContent(
      "---\nnodeId: m\nkind: concept\ntitle: m\n---\n## Evidence\n\n- bullet\n> quote\n",
      "wiki/concepts/m.md",
    );
    expect(r.sections.evidence).toEqual(["bullet", "quote"]);
  });

  it("evidence 空 section 返回空数组", () => {
    const r = parseWikiContent(
      "---\nnodeId: z\nkind: concept\ntitle: z\n---\n## Evidence\n\n\n",
      "wiki/concepts/z.md",
    );
    expect(r.sections.evidence).toEqual([]);
  });

  it("limits / useFor / links 全部按 splitLines 处理", () => {
    const r = parseWikiContent(
      "---\nnodeId: s\nkind: concept\ntitle: s\n---\n## Limits\n\n- l1\n- l2\n## Use For\n\n- u1\n## Links\n\n- link1\n",
      "wiki/concepts/s.md",
    );
    expect(r.sections.limits).toEqual(["l1", "l2"]);
    expect(r.sections.useFor).toEqual(["u1"]);
    expect(r.sections.links).toEqual(["link1"]);
  });
});

describe("wiki-parser — 引号值 (M2)", () => {
  it("title 双引号被剥", () => {
    const r = parseWikiContent(
      '---\nnodeId: q\nkind: concept\ntitle: "Quoted: with colon"\n---\n## Claim\nx\n',
      "wiki/concepts/q.md",
    );
    expect(r.frontmatter.title).toBe("Quoted: with colon");
  });

  it("title 单引号被剥", () => {
    const r = parseWikiContent(
      "---\nnodeId: q2\nkind: concept\ntitle: 'single quoted'\n---\n## Claim\nx\n",
      "wiki/concepts/q2.md",
    );
    expect(r.frontmatter.title).toBe("single quoted");
  });
});

describe("wiki-parser — 共享工具 (M9)", () => {
  it("scalar 数组取 [0]", () => {
    expect(scalar(["a", "b"])).toBe("a");
  });

  it("scalar 字符串原样返回", () => {
    expect(scalar("x")).toBe("x");
  });

  it("scalar undefined 返回 undefined", () => {
    expect(scalar(undefined)).toBeUndefined();
  });

  it("parseStringList 处理数组", () => {
    expect(parseStringList(["a", "b"])).toEqual(["a", "b"]);
  });

  it("parseStringList 处理 `[a, b]` 字符串", () => {
    expect(parseStringList("[a, b]")).toEqual(["a", "b"]);
  });

  it("parseStringList 处理逗号分隔字符串", () => {
    expect(parseStringList("a, b, c")).toEqual(["a", "b", "c"]);
  });

  it("parseStringList 处理空值", () => {
    expect(parseStringList("")).toEqual([]);
    expect(parseStringList(undefined)).toEqual([]);
  });

  it("parseChunkRefs 处理字符串数组", () => {
    expect(parseChunkRefs(["1", "2", "3"])).toEqual([1, 2, 3]);
  });

  it("parseChunkRefs 处理逗号字符串", () => {
    expect(parseChunkRefs("1, 2, 3")).toEqual([1, 2, 3]);
  });

  it("parseChunkRefs 过滤 NaN", () => {
    expect(parseChunkRefs("1, x, 3")).toEqual([1, 3]);
  });

  it("extractRawId 去掉 .md 与目录前缀", () => {
    expect(extractRawId("raw/chase/raw_pdf_x-abcd.md")).toBe("raw_pdf_x-abcd");
    expect(extractRawId("raw_pdf_x-abcd.md")).toBe("raw_pdf_x-abcd");
  });
});

describe("wiki-parser — v6 字段", () => {
  it("boardRoles 合法值原样保留", () => {
    const r = parseWikiContent(
      "---\nnodeId: b\nkind: concept\ntitle: b\nboardRoles:\n  - evidence\n  - concept\n---\n## Claim\nx\n",
      "wiki/concepts/b.md",
    );
    expect(r.frontmatter.boardRoles).toEqual(["evidence", "concept"]);
  });

  it("boardRoles 非法值被丢弃", () => {
    const r = parseWikiContent(
      "---\nnodeId: b\nkind: concept\ntitle: b\nboardRoles:\n  - evidence\n  - bogus\n---\n## Claim\nx\n",
      "wiki/concepts/b.md",
    );
    expect(r.frontmatter.boardRoles).toEqual(["evidence"]);
  });

  it("auditStatus 合法值保留", () => {
    const r = parseWikiContent(
      "---\nnodeId: a\nkind: concept\ntitle: a\nauditStatus: passed\n---\n## Claim\nx\n",
      "wiki/concepts/a.md",
    );
    expect(r.frontmatter.auditStatus).toBe("passed");
  });

  it("auditStatus 非法值回退到 'pending' 默认（宽容策略）", () => {
    const r = parseWikiContent(
      "---\nnodeId: a\nkind: concept\ntitle: a\nauditStatus: unknown\n---\n## Claim\nx\n",
      "wiki/concepts/a.md",
    );
    expect(r.frontmatter.auditStatus).toBe("pending");
  });
});
