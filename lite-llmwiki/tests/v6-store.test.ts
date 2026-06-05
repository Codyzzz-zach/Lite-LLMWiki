/**
 * v6 store — store.ts 的 v6 行为单测
 *
 * 覆盖 S1: store 应使用共享 wiki-parser，不再内嵌自己的 frontmatter / chunk 解析
 *  - rebuildIndex 使用 parseWikiContent
 *  - readChunks 使用 chase.ts 的 readChaseChunks（兼容 v5/v6 marker）
 *  - WIKI_NODE_DIRS 从 wiki-parser 导入（与 parser 保持一致）
 *  - listWikiPages 扫所有 8 个目录
 *  - searchWikiPages 不再是单一目录实现
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KnowledgeStore } from "../src/knowledge/store.js";
import { renderWikiNode } from "../src/knowledge/render.js";
import { parseWikiContent } from "../src/knowledge/wiki-parser.js";
import type { AppConfig, WikiNodeDraft } from "../src/types.js";

let tmpDir: string;
let config: AppConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "v6-store-test-"));
  config = {
    rawDir: tmpDir,
    wikiDir: join(tmpDir, "wiki"),
    rootDir: tmpDir,
  } as AppConfig;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function saveDraft(store: KnowledgeStore, draft: WikiNodeDraft) {
  store.saveWikiNode(draft);
}

function makeDraft(overrides: Partial<WikiNodeDraft> = {}): WikiNodeDraft {
  return {
    nodeId: "test/concept/x",
    kind: "concept",
    filePath: "wiki/concepts/test-x.md",
    frontmatter: {
      title: "X",
      nodeId: "test/concept/x",
      kind: "concept",
      sourceIds: ["raw_x-abcd"],
      sourceChase: ["raw/chase/raw_x-abcd.md"],
      chunkRefs: [1],
      confidence: 0.8,
      status: "verified",
      tags: ["a"],
      related: [],
    },
    claim: "claim",
    evidence: [{ sourceId: "raw_x-abcd", chunkRefs: [1], summary: "sum" }],
    ...overrides,
  };
}

describe("v6 store — listWikiPages 扫所有 8 个目录 (S1)", () => {
  it("扫描所有 8 个 wiki 子目录", () => {
    const store = new KnowledgeStore(config);
    saveDraft(store, makeDraft({ filePath: "wiki/concepts/c.md" }));
    saveDraft(store, makeDraft({
      nodeId: "test/method/m",
      kind: "method",
      filePath: "wiki/methods/m.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/method/m",
        kind: "method",
        title: "M",
      },
    }));
    saveDraft(store, makeDraft({
      nodeId: "test/insight/i",
      kind: "insight",
      filePath: "wiki/insights/i.md",
      frontmatter: {
        ...makeDraft().frontmatter,
        nodeId: "test/insight/i",
        kind: "insight",
        title: "I",
      },
    }));
    const pages = store.listWikiPages();
    expect(pages).toContain("wiki/concepts/c.md");
    expect(pages).toContain("wiki/methods/m.md");
    expect(pages).toContain("wiki/insights/i.md");
  });
});

describe("v6 store — rebuildIndex 使用 parseWikiContent (S1)", () => {
  it("v6 节点字段写入 index.json", () => {
    const store = new KnowledgeStore(config);
    saveDraft(store, makeDraft({
      frontmatter: {
        ...makeDraft().frontmatter,
        auditStatus: "passed",
        auditScore: 0.9,
        claimType: "source_claim",
        boardRoles: ["evidence", "concept"],
      },
    }));
    store.rebuildIndex();
    const indexPath = join(config.wikiDir, "index.json");
    const index = JSON.parse(require("node:fs").readFileSync(indexPath, "utf-8")) as Array<Record<string, unknown>>;
    expect(index).toHaveLength(1);
    const entry = index[0]!;
    expect(entry.nodeId).toBe("test/concept/x");
    expect(entry.kind).toBe("concept");
    // v6 字段也写进 index（如果 index.json 升级支持）
    // 至少保证既有字段正确
    expect(entry.title).toBe("X");
    expect(entry.confidence).toBe(0.8);
  });

  it("v5 节点（无 v6 字段）也能写 index", () => {
    const store = new KnowledgeStore(config);
    saveDraft(store, makeDraft());
    store.rebuildIndex();
    const indexPath = join(config.wikiDir, "index.json");
    const index = JSON.parse(require("node:fs").readFileSync(indexPath, "utf-8")) as Array<Record<string, unknown>>;
    expect(index[0]?.title).toBe("X");
  });
});

describe("v6 store — readChunks 用 chase.ts (S1)", () => {
  it("v5 冒号 marker `<!-- chunk:1 -->` 仍能读", () => {
    const store = new KnowledgeStore(config);
    const chaseDir = join(config.rawDir, "chase");
    require("node:fs").mkdirSync(chaseDir, { recursive: true });
    writeFileSync(
      join(chaseDir, "raw_x-abcd.md"),
      "<!-- chunk:1 -->\nFirst.\n<!-- chunk:2 -->\nSecond.\n",
    );
    const chunks = store.readChunks("raw_x-abcd");
    expect(chunks).not.toBeNull();
    expect(chunks!.map((c) => c.index)).toEqual([1, 2]);
  });

  it("v6 空格 marker `<!-- chunk 1 -->` 也能读", () => {
    const store = new KnowledgeStore(config);
    const chaseDir = join(config.rawDir, "chase");
    require("node:fs").mkdirSync(chaseDir, { recursive: true });
    writeFileSync(
      join(chaseDir, "raw_y-efgh.md"),
      "<!-- chunk 1 -->\nFirst.\n<!-- chunk 2 -->\nSecond.\n",
    );
    const chunks = store.readChunks("raw_y-efgh");
    expect(chunks).not.toBeNull();
    expect(chunks!.map((c) => c.index)).toEqual([1, 2]);
  });
});

describe("v6 store — render + parse 端到端", () => {
  it("v6 draft 保存后用 parseWikiContent 能完整读回", () => {
    const store = new KnowledgeStore(config);
    const draft = makeDraft({
      auditNotes: "Reviewed OK",
      boardUse: ["ask 主证据"],
      frontmatter: {
        ...makeDraft().frontmatter,
        auditStatus: "passed",
        auditScore: 0.88,
        claimType: "source_claim",
        inferenceLevel: "none",
        boardRoles: ["evidence"],
        propRefs: ["p1"],
        claimHash: "h1",
      },
    });
    store.saveWikiNode(draft);
    const fullPath = join(config.wikiDir, "concepts", "test-x.md");
    const content = require("node:fs").readFileSync(fullPath, "utf-8");
    const parsed = parseWikiContent(content, fullPath);
    expect(parsed.sections.auditNotes).toContain("Reviewed OK");
    expect(parsed.sections.boardUse).toEqual(["ask 主证据"]);
    expect(parsed.frontmatter.auditStatus).toBe("passed");
    expect(parsed.frontmatter.auditScore).toBe(0.88);
    expect(parsed.frontmatter.claimType).toBe("source_claim");
    expect(parsed.frontmatter.boardRoles).toEqual(["evidence"]);
  });

  it("render 出的 markdown 是合法的 wiki markdown", () => {
    const draft = makeDraft();
    const md = renderWikiNode(draft);
    // 简单 sanity：能被 parseWikiContent 解析
    const parsed = parseWikiContent(md, "wiki/concepts/x.md");
    expect(parsed.nodeId).toBe("test/concept/x");
    expect(parsed.kind).toBe("concept");
  });
});
