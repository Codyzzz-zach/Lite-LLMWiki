import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { KnowledgeStore } from "../src/knowledge/store.js";
import type { AppConfig, Source } from "../src/types.js";

function testConfig(root: string): AppConfig {
  return {
    apiKey: "",
    baseUrl: "",
    projectRoot: root,
    rawDir: join(root, "raw"),
    wikiDir: join(root, "wiki"),
    model: "test-model",
    chunkTokenTarget: 100,
    chunkOverlapTokens: 10,
  };
}

function testSource(root: string, type: Source["type"]): Source {
  const originalPath = join(root, `source.${type}`);
  writeFileSync(originalPath, `ORIGINAL ${type.toUpperCase()} BYTES`, "utf-8");

  return {
    id: `raw/${type}/source-fingerprint`,
    path: originalPath,
    type,
    title: `${type} title`,
    meta: {},
    body: `# Cleaned ${type}\n\nThis is the markdown chase layer.`,
    chunks: [
      {
        id: `raw/${type}/source-fingerprint-#0`,
        index: 0,
        text: "This is the markdown chase layer.",
        tokenEstimate: 8,
        charStart: 0,
        charEnd: 33,
      },
    ],
    totalTokens: 8,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    fingerprint: "fingerprint",
  };
}

describe("KnowledgeStore.saveRaw", () => {
  it.each(["md", "pdf", "tex"] as const)(
    "stores %s original and cleaned chase markdown",
    (type) => {
      const root = mkdtempSync(join(tmpdir(), "litewiki-store-"));
      const config = testConfig(root);
      const source = testSource(root, type);
      const store = new KnowledgeStore(config);

      const chasePath = store.saveRaw(source);
      const chase = readFileSync(chasePath, "utf-8");
      const original = readFileSync(
        join(config.rawDir, "original", type, basename(source.path)),
        "utf-8",
      );

      expect(chasePath).toBe(join(config.rawDir, "chase", `raw_${type}_source-fingerprint.md`));
      expect(chase).toContain(`sourceType: ${type}`);
      expect(chase).toContain("This is the markdown chase layer.");
      expect(chase).not.toContain(`ORIGINAL ${type.toUpperCase()} BYTES`);
      expect(original).toBe(`ORIGINAL ${type.toUpperCase()} BYTES`);
      expect(store.readRaw(source.id)).toBe(chase);
    },
  );

  it("does not fail when the source file already lives in raw/original", () => {
    const root = mkdtempSync(join(tmpdir(), "litewiki-store-"));
    const config = testConfig(root);
    const source = testSource(root, "pdf");
    const store = new KnowledgeStore(config);

    store.saveRaw(source);
    const originalPath = join(config.rawDir, "original", "pdf", basename(source.path));
    const resavedSource = { ...source, path: originalPath };

    expect(() => store.saveRaw(resavedSource)).not.toThrow();
    expect(readFileSync(originalPath, "utf-8")).toBe("ORIGINAL PDF BYTES");
  });

  it("does not duplicate a source that already lives under raw/original", () => {
    const root = mkdtempSync(join(tmpdir(), "litewiki-store-"));
    const config = testConfig(root);
    const originalPath = join(config.rawDir, "original", "tex", "paper", "main.tex");
    mkdirSync(join(config.rawDir, "original", "tex", "paper"), { recursive: true });
    writeFileSync(originalPath, "ORIGINAL TEX BYTES", "utf-8");
    const source = {
      ...testSource(root, "tex"),
      path: originalPath,
    };
    const store = new KnowledgeStore(config);

    store.saveRaw(source);

    expect(readFileSync(originalPath, "utf-8")).toBe("ORIGINAL TEX BYTES");
    expect(() => readFileSync(join(config.rawDir, "original", "tex", "main.tex"), "utf-8"))
      .toThrow();
  });

  it("stores a TeX project folder as the original source unit", () => {
    const root = mkdtempSync(join(tmpdir(), "litewiki-store-"));
    const config = testConfig(root);
    const projectDir = join(root, "paper-project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "main.tex"), "MAIN TEX", "utf-8");
    writeFileSync(join(projectDir, "section.tex"), "SECTION TEX", "utf-8");
    const source = {
      ...testSource(root, "tex"),
      path: join(projectDir, "main.tex"),
      sourceRoot: projectDir,
    };
    const store = new KnowledgeStore(config);

    const chasePath = store.saveRaw(source);

    expect(readFileSync(join(config.rawDir, "original", "tex", "paper-project", "main.tex"), "utf-8"))
      .toBe("MAIN TEX");
    expect(
      readFileSync(join(config.rawDir, "original", "tex", "paper-project", "section.tex"), "utf-8"),
    ).toBe("SECTION TEX");
    expect(readFileSync(chasePath, "utf-8")).toContain(`sourceRoot: ${projectDir}`);
    expect(() => readFileSync(join(config.rawDir, "original", "tex", "main.tex"), "utf-8"))
      .toThrow();
  });
});
