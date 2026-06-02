import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import type { AppConfig, Chunk, Source, WikiNodeDraft, WikiPage } from "../types.js";
import { estimateTokens } from "../ingest/loader.js";
import { renderWikiNode } from "./render.js";

const WIKI_NODE_DIRS = ["concepts", "methods", "cases", "equations", "questions", "insights", "anchors", "counters"];

/**
 * KnowledgeStore — 纯文件存储
 *
 * 三个存储层：
 * - raw/original/<format>/  原始材料副本
 * - raw/chase/              清洗后的 Markdown 中间层
 * - wiki/   编译产物（Markdown）
 *
 * 不再依赖 SQLite 图谱。
 */
export class KnowledgeStore {
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  // ─── Raw Layer ──────────────────────────────────────────────────

  /** 保存原始材料副本和进入 LLM 的清洗后 Markdown */
  saveRaw(source: Source): string {
    const chaseDir = join(this.config.rawDir, "chase");
    mkdirSync(chaseDir, { recursive: true });
    const cleanId = source.id.replace(/[\/:]/g, "_");
    const destPath = join(chaseDir, `${cleanId}.md`);

    const originalSource = source.sourceRoot ?? source.path;
    if (existsSync(originalSource)) {
      const sourcePath = resolve(originalSource);
      const originalRoot = resolve(this.config.rawDir, "original");
      const isAlreadyOriginal =
        sourcePath === originalRoot || sourcePath.startsWith(`${originalRoot}${sep}`);

      if (!isAlreadyOriginal) {
        const sourceStat = statSync(originalSource);
        const sourceExt = sourceStat.isDirectory()
          ? source.type
          : extname(originalSource).replace(/^\./, "").toLowerCase() || "unknown";
        const originalDir = join(this.config.rawDir, "original", sourceExt);
        mkdirSync(originalDir, { recursive: true });
        const originalDest = join(originalDir, basename(originalSource));
        if (sourceStat.isDirectory()) {
          cpSync(originalSource, originalDest, { recursive: true });
        } else {
          copyFileSync(originalSource, originalDest);
        }
      }
    }

    const bodyContent = source.body || source.chunks.map((c) => c.text).join("\n\n");
    const chunkMarkers = source.chunks.length > 0
      ? "\n" + source.chunks.map((c) =>
        `<!-- chunk:${c.index + 1} id=${c.id} charStart=${c.charStart} charEnd=${c.charEnd} -->\n${c.text}\n<!-- /chunk:${c.index + 1} -->`
      ).join("\n")
      : "";

    const content = [
      "---",
      `sourceId: ${source.id.replace(/[\/:]/g, "_")}`,
      `title: ${source.title}`,
      `sourcePath: ${source.path}`,
      ...(source.sourceRoot ? [`sourceRoot: ${source.sourceRoot}`] : []),
      `sourceType: ${source.type}`,
      `fingerprint: ${source.fingerprint}`,
      `chunkCount: ${source.chunks.length}`,
      "loaderVersion: v5.0",
      `createdAt: ${source.createdAt.toISOString()}`,
      "---",
      "",
      bodyContent + chunkMarkers,
    ].join("\n");

    writeFileSync(destPath, content, "utf-8");
    return destPath;
  }

  /** 读取 raw 文件 */
  readRaw(rawId: string): string | null {
    const dir = join(this.config.rawDir, "chase");
    if (!existsSync(dir)) return null;
    const files = new Set([
      join(dir, `${rawId.replace(/[\/:]/g, "_")}.md`),
      join(dir, `${rawId}.md`),
    ]);
    for (const f of files) {
      if (existsSync(f)) return readFileSync(f, "utf-8");
    }
    return null;
  }

  /** 从 chase 文件解析 chunk 边界（解析 HTML 注释标记） */
  readChunks(rawId: string): Chunk[] | null {
    const content = this.readRaw(rawId);
    if (!content) return null;

    const chunks: Chunk[] = [];
    const re = /<!--\s*chunk:(\d+)(?:\s+[^>]*)?\s*-->\s*\n?([\s\S]*?)\n?\s*<!--\s*\/chunk:\1\s*-->/g;
    let match: RegExpExecArray | null;

    while ((match = re.exec(content)) !== null) {
      const index = parseInt(match[1]!, 10);
      const text = match[2]!;
      const cleanId = rawId.replace(/[\/:]/g, "_");
      chunks.push({
        id: `${cleanId}-chunk${index}`,
        index,
        text,
        tokenEstimate: estimateTokens(text),
        charStart: 0,
        charEnd: 0,
      });
    }

    return chunks.length > 0 ? chunks.sort((a, b) => a.index - b.index) : null;
  }

  // ─── Wiki Layer ──────────────────────────────────────────────────

  /** 将 wiki 页面写入 wiki/ 目录，支持 append 模式 */
  saveWikiPage(page: WikiPage): string {
    // filePath 格式为 "wiki/concepts/xxx.md"，去掉 "wiki/" 前缀再拼 wikiDir
    const relPath = page.filePath.startsWith("wiki/") ? page.filePath.slice(5) : page.filePath;
    if (!relPath) throw new Error(`saveWikiPage: empty filePath for node "${page.nodeId}"`);
    const fullPath = page.filePath.startsWith("/")
      ? page.filePath
      : join(this.config.wikiDir, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });

    // append 模式：追加到已有文件末尾
    if (page.updateType === "append" && existsSync(fullPath)) {
      const existing = readFileSync(fullPath, "utf-8");
      writeFileSync(fullPath, existing + "\n" + page.body, "utf-8");
      return fullPath;
    }

    // replace / new
    const frontmatterLines = Object.entries(page.frontmatter).map(
      ([key, value]) => `${key}: ${value}`,
    );
    const content = [
      "---",
      ...frontmatterLines,
      "---",
      "",
      page.body,
    ].join("\n");

    writeFileSync(fullPath, content, "utf-8");
    return fullPath;
  }

  /** 渲染并保存 wiki 节点（v5 固定格式：frontmatter + Claim/Evidence/Interpretation/Use For/Limits/Links sections） */
  saveWikiNode(draft: WikiNodeDraft): string {
    const content = renderWikiNode({
      ...draft,
      frontmatter: {
        ...draft.frontmatter,
        sourceChase: draft.frontmatter.sourceChase?.length
          ? draft.frontmatter.sourceChase
          : draft.frontmatter.sourceIds?.map((sourceId) => `raw/chase/${sourceId.replace(/[\/:]/g, "_")}.md`) ?? [],
      },
    });
    const relPath = draft.filePath.startsWith("wiki/") ? draft.filePath.slice(5) : draft.filePath;
    const fullPath = relPath.startsWith("/")
      ? relPath
      : join(this.config.wikiDir, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
    return fullPath;
  }

  /** 读取 wiki 页面 */
  readWikiPage(filePath: string): string | null {
    const relPath = filePath.startsWith("wiki/") ? filePath.slice(5) : filePath;
    const fullPath = relPath.startsWith("/")
      ? relPath
      : join(this.config.wikiDir, relPath);
    if (!existsSync(fullPath)) return null;
    return readFileSync(fullPath, "utf-8");
  }

  /** 列出所有 wiki 文件 */
  listWikiPages(): string[] {
    return WIKI_NODE_DIRS.flatMap((dirName) => {
      const dir = join(this.config.wikiDir, dirName);
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => `wiki/${dirName}/${f}`);
    });
  }

  /** 搜索 wiki 文件内容（通过文件名/摘要行匹配） */
  searchWikiPages(query: string): Array<{ filePath: string; title: string }> {
    const dir = join(this.config.wikiDir, "concepts");
    if (!existsSync(dir)) return [];

    const keywords = query.toLowerCase().split(/[\s,，。？、；：]+/).filter((w) => w.length > 0);
    if (keywords.length === 0) return [];

    const results: Array<{ filePath: string; title: string }> = [];
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      const content = readFileSync(join(dir, file), "utf-8");
      const lower = content.toLowerCase();

      // 检查是否匹配任意关键词
      const matched = keywords.filter((k) => lower.includes(k));
      if (matched.length > 0) {
        // 从 frontmatter 提取标题
        const titleMatch = content.match(/^---\n.*?title:\s*(.+)\n.*?---/s);
        const title = titleMatch ? titleMatch[1]!.trim() : file.replace(/\.md$/, "");
        results.push({
          filePath: `wiki/concepts/${file}`,
          title,
        });
      }
    }

    return results;
  }

  /** 找到与给定命题相关的已有 wiki 页面（用于 compile 阶段的 cross-page update）*/
  findRelatedPages(propositions: Array<{ claim: string }>): Array<{ filePath: string; title: string; summary: string }> {
    const dir = join(this.config.wikiDir, "concepts");
    if (!existsSync(dir)) return [];

    const results: Array<{ filePath: string; title: string; summary: string }> = [];
    const files = readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_devils-") && !f.startsWith("anchor-"));

    // 从 proposition 中提取关键词：英文分词 + 中文 2-gram
    const propText = propositions.map((p) => p.claim).join(" ");
    const keywords = new Set<string>();
    for (const term of propText.split(/[\s,，。！？、；：""''（）\(\)\[\]【】]+/)) {
      const lower = term.toLowerCase().trim();
      if (lower.length <= 1) continue;
      if (/^[a-zA-Z\d\-_]+$/.test(lower)) {
        keywords.add(lower);
      } else {
        // 中文 2-gram
        for (let i = 0; i <= lower.length - 2; i++) {
          const gram = lower.slice(i, i + 2);
          if (gram.length === 2) keywords.add(gram);
        }
      }
    }

    const kwList = [...keywords].filter((w) => w.length > 1);
    if (kwList.length === 0) return [];

    for (const file of files) {
      const content = readFileSync(join(dir, file), "utf-8");
      const lower = content.toLowerCase();
      const hits = kwList.filter((w) => lower.includes(w)).length;
      if (hits >= 2) {
        // title: 只在 frontmatter 块内匹配
        const fm = content.match(/^---\n([\s\S]*?)\n---/);
        const titleMatch = fm ? fm[1]!.match(/^title:\s*(.+)$/m) : null;
        const title = titleMatch ? titleMatch[1]!.trim() : file;
        const summary = content.split("---").pop()?.trim().slice(0, 200) ?? "";
        results.push({ filePath: `wiki/concepts/${file}`, title, summary });
      }
    }

    return results.slice(0, 8);
  }

  // ─── 统计 ────────────────────────────────────────────────────────

  getStats(): { totalSources: number; totalNodes: number } {
    let totalSources = 0;
    const rawChaseDir = join(this.config.rawDir, "chase");
    if (existsSync(rawChaseDir)) {
      totalSources = readdirSync(rawChaseDir).filter((f) => f.endsWith(".md")).length;
    }

    const totalNodes = this.listWikiPages().length;

    return { totalSources, totalNodes };
  }

  // ─── Index & Log ──────────────────────────────────────────────────

  /** 重建 wiki/index.md + wiki/index.json — 所有页面的目录和机器 manifest */
  rebuildIndex(): string {
    const conceptsDir = join(this.config.wikiDir, "concepts");
    if (!existsSync(conceptsDir)) mkdirSync(conceptsDir, { recursive: true });
    const pagePaths = this.listWikiPages();
    // ── index.md ──
    let md = "# Wiki Index\n\n";

    md += `## Nodes (${pagePaths.length})\n`;
    for (const filePath of pagePaths) {
      const content = this.readWikiPage(filePath) ?? "";
      const t = content.match(/^title:\s*(.+)/m);
      const c = content.match(/^confidence:\s*(.+)/m);
      const title = t ? t[1]!.trim() : filePath.replace(/\.md$/, "");
      const conf = c ? parseFloat(c[1]!) : 0;
      md += `- [${title}](${filePath.replace(/^wiki\//, "")}) — conf: ${conf.toFixed(1)}\n`;
    }

    md += `\n*Last updated: ${new Date().toISOString()}*\n`;

    const indexPath = join(this.config.wikiDir, "index.md");
    writeFileSync(indexPath, md, "utf-8");

    // ── index.json (机器 manifest) ──
    type IndexEntry = {
      nodeId: string;
      kind: string;
      title: string;
      filePath: string;
      sourceIds: string[];
      tags: string[];
      confidence: number;
      updatedAt: string;
    };

    const entries: IndexEntry[] = [];

    for (const filePath of pagePaths) {
      const content = this.readWikiPage(filePath) ?? "";

      // 解析 frontmatter
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      const fm: Record<string, string | string[]> = {};
      if (fmMatch) {
        let currentArrayKey: string | null = null;
        for (const line of fmMatch[1]!.split("\n")) {
          const arrayItem = line.match(/^\s*-\s+(.+)$/);
          if (arrayItem && currentArrayKey) {
            const current = fm[currentArrayKey];
            fm[currentArrayKey] = [...(Array.isArray(current) ? current : []), arrayItem[1]!.trim().replace(/^"(.*)"$/, "$1")];
            continue;
          }
          const colon = line.indexOf(":");
          if (colon > 0) {
            const key = line.slice(0, colon).trim();
            const value = line.slice(colon + 1).trim();
            if (value) {
              fm[key] = value.replace(/^"(.*)"$/, "$1");
              currentArrayKey = null;
            } else {
              fm[key] = [];
              currentArrayKey = key;
            }
          }
        }
      }

      const nodeId = scalar(fm["nodeId"]) ?? filePath.replace(/^wiki\//, "").replace(/\.md$/, "");
      const kind = scalar(fm["kind"]) ?? filePath.split("/").at(-2) ?? "concept";
      const title = scalar(fm["title"]) || nodeId;
      const sourceIds: string[] = list(fm["sourceIds"]).length > 0
        ? list(fm["sourceIds"])
        : scalar(fm["source"]) ? [scalar(fm["source"])!] : [];
      const tags: string[] = list(fm["tags"]);
      const confidence = scalar(fm["confidence"]) ? parseFloat(scalar(fm["confidence"])!) : 0;
      const updatedAt = scalar(fm["updatedAt"]) || scalar(fm["createdAt"]) || new Date().toISOString();

      entries.push({ nodeId, kind, title, filePath, sourceIds, tags, confidence, updatedAt });
    }

    const jsonPath = join(this.config.wikiDir, "index.json");
    writeFileSync(jsonPath, JSON.stringify(entries, null, 2), "utf-8");

    return indexPath;
  }

  /** 追加 log.md 记录 */
  appendLog(entry: { title: string; source: string; anchor?: string; confirmed: number; total: number; newPages: number; updatedPages: number }): string {
    const logPath = join(this.config.wikiDir, "log.md");
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    const lines = [
      `## [${now}] ingest | ${entry.title.slice(0, 60)}`,
      `- source: ${entry.source}`,
      entry.anchor ? `- anchor: "${entry.anchor.slice(0, 80)}"` : "",
      `- confirmed: ${entry.confirmed}/${entry.total} propositions`,
      `- pages: ${entry.newPages} new, ${entry.updatedPages} updated`,
      "",
    ].filter(Boolean).join("\n") + "\n";

    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, lines, { flag: "a" }); // append mode
    return logPath;
  }
}

function scalar(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function list(value: string | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return value.split(/,\s*/).filter(Boolean);
}
