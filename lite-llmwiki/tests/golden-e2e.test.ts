/**
 * Golden E2E — filesystem-only second-brain contract.
 *
 * This suite does not depend on the repository's gitignored raw/wiki folders.
 * It builds a temporary project root with md/pdf/tex chase files and legacy wiki
 * pages, then verifies the local non-LLM pipeline: store, audit, search, inspire,
 * and index rebuild.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { auditWiki } from "../src/knowledge/audit.js";
import { KnowledgeStore } from "../src/knowledge/store.js";
import { searchWiki } from "../src/query/search.js";
import type { AppConfig, WikiNodeDraft } from "../src/types.js";

function testConfig(root: string): AppConfig {
  return {
    apiKey: "",
    baseUrl: "https://api.deepseek.com",
    projectRoot: root,
    rawDir: join(root, "raw"),
    wikiDir: join(root, "wiki"),
    model: "test-model",
    chunkTokenTarget: 100,
    chunkOverlapTokens: 10,
  };
}

function writeChase(config: AppConfig, fileName: string, frontmatter: string[], body: string): void {
  const chaseDir = join(config.rawDir, "chase");
  mkdirSync(chaseDir, { recursive: true });
  const markedBody = [
    body,
    "",
    "<!-- chunk:1 id=test-chunk-1 charStart=0 charEnd=100 -->",
    body,
    "<!-- /chunk:1 -->",
  ].join("\n");
  writeFileSync(
    join(chaseDir, fileName),
    ["---", ...frontmatter, "---", "", markedBody].join("\n"),
    "utf-8",
  );
}

function writeOriginalFixtures(config: AppConfig): void {
  mkdirSync(join(config.rawDir, "original", "pdf"), { recursive: true });
  mkdirSync(join(config.rawDir, "original", "md"), { recursive: true });
  mkdirSync(join(config.rawDir, "original", "tex", "arXiv-1503.02531v1"), { recursive: true });

  writeFileSync(join(config.rawDir, "original", "pdf", "e 的基本画像.pdf"), "PDF bytes", "utf-8");
  writeFileSync(join(config.rawDir, "original", "md", "graph-rag-paper.md"), "Graph-RAG markdown", "utf-8");
  writeFileSync(
    join(config.rawDir, "original", "tex", "arXiv-1503.02531v1", "main11.tex"),
    "\\documentclass{article}",
    "utf-8",
  );
}

function writeLegacyPage(config: AppConfig, fileName: string, title: string, body: string): void {
  const conceptsDir = join(config.wikiDir, "concepts");
  mkdirSync(conceptsDir, { recursive: true });
  writeFileSync(
    join(conceptsDir, fileName),
    [
      "---",
      `title: ${title}`,
      "source: e 的基本画像",
      "confidence: 0.9",
      "---",
      "",
      `# ${title}`,
      "",
      body,
    ].join("\n"),
    "utf-8",
  );
}

function createGoldenProject(): { root: string; config: AppConfig; store: KnowledgeStore } {
  const root = mkdtempSync(join(tmpdir(), "litewiki-golden-"));
  const config = testConfig(root);
  const store = new KnowledgeStore(config);

  writeOriginalFixtures(config);

  writeChase(
    config,
    "raw_pdf_e 的基本画像-101349df399af024.md",
    [
      "title: e 的基本画像",
      "sourcePath: raw/original/pdf/e 的基本画像.pdf",
      "sourceType: pdf",
      "fingerprint: 101349df399af024",
    ],
    [
      "下面是一份围绕常数 1/e 的系统说明书。",
      "错位排列中，没有任何人拿对帽子的概率随 n 增大趋近 1/e。",
      "秘书问题中先观察约 37% 的候选人，然后选择第一个超过样本标尺的人。",
      "RC 电路和一级化学反应中，时间常数对应 1/e 或 1-1/e。",
    ].join("\n"),
  );

  writeChase(
    config,
    "raw_md_graph-rag-paper-1a0fe6ff22d39a3b.md",
    [
      'title: "Graph-RAG 论文笔记"',
      "sourcePath: raw/original/md/graph-rag-paper.md",
      "sourceType: md",
      "fingerprint: 1a0fe6ff22d39a3b",
    ],
    "Graph-RAG combines Graph Indexing and Graph Retrieval for multi-hop knowledge retrieval.",
  );

  writeChase(
    config,
    "raw_tex_main11-5112df995da90d5f.md",
    [
      "title: Distilling the Knowledge in a Neural Network",
      "sourcePath: raw/original/tex/arXiv-1503.02531v1/main11.tex",
      "sourceRoot: raw/original/tex/arXiv-1503.02531v1",
      "sourceType: tex",
      "fingerprint: 5112df995da90d5f",
    ],
    "Distilling the knowledge in a neural network transfers knowledge from ensemble models.",
  );

  writeLegacyPage(
    config,
    "1minus_e_probability_limit.md",
    "1/e 的概率极限角色",
    [
      "## 极限与经典场景",
      "1/e 是许多微小机会都失败的极限概率。错位排列和伯努利试验都指向这个失败概率基线。",
      "",
      "## 信息论视角",
      "概率约 36.8% 的事件对总体不确定性的边际贡献最大。",
    ].join("\n"),
  );
  writeLegacyPage(
    config,
    "1minus_e_exponential_decay.md",
    "1/e 作为指数衰减的特征时间",
    "指数分布、RC 电路和一级化学反应都使用 1/e 或 1-1/e 描述时间常数。",
  );
  writeLegacyPage(
    config,
    "1minus_e_decision_algorithm.md",
    "1/e 与最优停止和贪心算法",
    "秘书问题和 1/e 法则提供探索与利用的决策策略，贪心算法有 1-1/e 近似保证。",
  );
  writeLegacyPage(
    config,
    "_devils-advocate-6ed64c50.md",
    "反直觉视角: e 的基本画像",
    "大量机会叠加后，一无所获的概率仍可能稳定在 37%。",
  );
  writeLegacyPage(
    config,
    "anchor-3aa60acf40bc.md",
    "1/e essence",
    "## Anchor\n1/e 是失败概率、时间常数和探索利用策略的共同锚点。",
  );

  return { root, config, store };
}

let config: AppConfig;
let store: KnowledgeStore;

beforeEach(() => {
  ({ config, store } = createGoldenProject());
});

describe("Phase 1: Chase file integrity (md/pdf/tex)", () => {
  it("has three deterministic chase files and original source folders", () => {
    expect(existsSync(join(config.rawDir, "chase", "raw_pdf_e 的基本画像-101349df399af024.md"))).toBe(true);
    expect(existsSync(join(config.rawDir, "chase", "raw_md_graph-rag-paper-1a0fe6ff22d39a3b.md"))).toBe(true);
    expect(existsSync(join(config.rawDir, "chase", "raw_tex_main11-5112df995da90d5f.md"))).toBe(true);

    expect(existsSync(join(config.rawDir, "original", "pdf", "e 的基本画像.pdf"))).toBe(true);
    expect(existsSync(join(config.rawDir, "original", "md", "graph-rag-paper.md"))).toBe(true);
    expect(existsSync(join(config.rawDir, "original", "tex", "arXiv-1503.02531v1", "main11.tex"))).toBe(true);
  });

  it("keeps TeX as a project source unit in chase frontmatter", () => {
    const tex = readFileSync(join(config.rawDir, "chase", "raw_tex_main11-5112df995da90d5f.md"), "utf-8");
    expect(tex).toContain("sourceType: tex");
    expect(tex).toContain("sourceRoot: raw/original/tex/arXiv-1503.02531v1");
  });
});

describe("Phase 2: Audit legacy wiki", () => {
  it("identifies all five existing pages as legacy warnings", () => {
    const result = auditWiki(config);

    expect(result.ok).toBe(true);
    expect(result.summary.nodes).toBe(5);
    expect(result.summary.verifiedNodes).toBe(0);
    expect(result.summary.coverage).toBe(0);
    expect(result.issues.filter((i) => i.severity === "warning" && i.message.includes("Legacy page")))
      .toHaveLength(5);
  });
});

describe("Phase 3: Search legacy and v5-readable pages", () => {
  it('search "1/e 失败概率" recalls e-related pages', () => {
    const matches = searchWiki(config, "1/e 失败概率");

    expect(matches.length).toBeGreaterThanOrEqual(3);
    expect(matches.some((m) => m.title.includes("概率极限"))).toBe(true);
  });

  it("returns a stable structured result shape", () => {
    const matches = searchWiki(config, "1/e");

    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) {
      expect(match.nodeId).toBeTruthy();
      expect(match.kind).toBeTruthy();
      expect(match.title).toBeTruthy();
      expect(match.filePath).toMatch(/^wiki\/concepts\//);
      expect(match.score).toBeGreaterThan(0);
      expect(typeof match.claim).toBe("string");
      expect(Array.isArray(match.evidence)).toBe(true);
    }
  });
});

describe("Phase 5: KnowledgeStore filesystem operations", () => {
  it("readRaw reads all three chase files by raw id", () => {
    expect(store.readRaw("raw_pdf_e 的基本画像-101349df399af024")).toContain("sourceType: pdf");
    expect(store.readRaw("raw_md_graph-rag-paper-1a0fe6ff22d39a3b")).toContain("sourceType: md");
    expect(store.readRaw("raw_tex_main11-5112df995da90d5f")).toContain("sourceType: tex");
  });

  it("reports source and node counts for the fixture", () => {
    const stats = store.getStats();

    expect(stats.totalSources).toBe(3);
    expect(stats.totalNodes).toBe(5);
  });

  it("lists legacy wiki pages and rebuilds markdown/json index", () => {
    const pages = store.listWikiPages();
    expect(pages).toHaveLength(5);

    const indexPath = store.rebuildIndex();
    expect(existsSync(indexPath)).toBe(true);

    const indexContent = readFileSync(indexPath, "utf-8");
    expect(indexContent).toContain("# Wiki Index");
    expect(indexContent).toContain("1/e 的概率极限角色");

    const jsonPath = join(config.wikiDir, "index.json");
    expect(existsSync(jsonPath)).toBe(true);
    const jsonContent = JSON.parse(readFileSync(jsonPath, "utf-8")) as unknown[];
    expect(jsonContent.length).toBe(5);
  });
});

describe("Phase 6: v5 verified node contract", () => {
  it("saves a schema-complete v5 node that audit can verify", () => {
    const draft: WikiNodeDraft = {
      nodeId: "concept/one-over-e-probability-limit",
      kind: "concept",
      filePath: "wiki/concepts/one-over-e-probability-limit.md",
      frontmatter: {
        title: "1/e 的概率极限角色",
        sourceIds: ["raw_pdf_e 的基本画像-101349df399af024"],
        sourceChase: ["raw/chase/raw_pdf_e 的基本画像-101349df399af024.md"],
        propRefs: ["1"],
        confidence: 0.86,
        status: "verified",
        tags: ["probability", "one-over-e"],
        related: [],
      },
      claim: "1/e 经常作为许多微小机会都失败的极限概率出现。",
      evidence: [{
        sourceId: "raw_pdf_e 的基本画像-101349df399af024",
        propRefs: ["1"],
        summary: "错位排列和多次小概率试验都指向 1/e 失败概率。",
        excerpt: "错位排列中，没有任何人拿对帽子的概率随 n 增大趋近 1/e。",
      }],
      interpretation: "它可以作为风险判断中的失败概率基线。",
      useFor: ["评估多次小概率尝试的一无所获概率"],
      limits: ["依赖独立性和小概率试验结构"],
    };

    store.saveWikiNode(draft);
    const saved = readFileSync(join(config.wikiDir, "concepts", "one-over-e-probability-limit.md"), "utf-8");

    expect(saved).toContain("nodeId: concept/one-over-e-probability-limit");
    expect(saved).toContain("kind: concept");
    expect(saved).toContain("sourceChase:");
    expect(saved).toContain("propRefs:");
    expect(saved).toContain("Summary: 错位排列和多次小概率试验都指向 1/e 失败概率。");

    const result = auditWiki(config);
    expect(result.ok).toBe(true);
    expect(result.summary.verifiedNodes).toBe(1);
  });

  it("saves a v5 counter node that audit can verify", () => {
    const draft: WikiNodeDraft = {
      nodeId: "counter-399af024",
      kind: "counter",
      filePath: "wiki/counters/counter-399af024.md",
      frontmatter: {
        title: "反直觉视角: e 的基本画像",
        sourceIds: ["raw_pdf_e 的基本画像-101349df399af024"],
        sourceChase: ["raw/chase/raw_pdf_e 的基本画像-101349df399af024.md"],
        propRefs: ["1"],
        confidence: 0.55,
        status: "verified",
        tags: ["counter-intuitive"],
        related: [],
      },
      claim: "这份材料中有已确认知识点挑战了常见认知。",
      evidence: [{
        sourceId: "raw_pdf_e 的基本画像-101349df399af024",
        propRefs: ["1"],
        summary: "大量机会叠加后，一无所获的概率仍可能稳定在 37%。",
      }],
      interpretation: "- 多次机会并不保证成功，失败概率可以稳定收敛到 1/e。",
      useFor: ["提醒 agent 保留反直觉视角"],
      limits: ["这是聚合视角，不替代原始节点证据"],
    };

    store.saveWikiNode(draft);
    store.rebuildIndex();

    const saved = readFileSync(join(config.wikiDir, "counters", "counter-399af024.md"), "utf-8");
    expect(saved).toContain("kind: counter");

    const result = auditWiki(config);
    expect(result.ok).toBe(true);
    expect(result.summary.verifiedNodes).toBe(1);

    const index = JSON.parse(readFileSync(join(config.wikiDir, "index.json"), "utf-8")) as Array<{ kind: string; filePath: string }>;
    expect(index.some((entry) => entry.kind === "counter" && entry.filePath === "wiki/counters/counter-399af024.md")).toBe(true);
  });

  it("fails audit for a v5 node with broken sourceChase", () => {
    const draft: WikiNodeDraft = {
      nodeId: "concept/broken",
      kind: "concept",
      filePath: "wiki/concepts/broken.md",
      frontmatter: {
        title: "Broken",
        sourceIds: ["missing-source"],
        sourceChase: ["raw/chase/missing-source.md"],
        propRefs: ["1"],
        confidence: 0.8,
        status: "verified",
        tags: [],
        related: [],
      },
      claim: "Broken claim",
      evidence: [{
        sourceId: "missing-source",
        propRefs: ["1"],
        summary: "Missing source.",
      }],
    };

    store.saveWikiNode(draft);
    const result = auditWiki(config);

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes("sourceChase file not found"))).toBe(true);
  });
});
