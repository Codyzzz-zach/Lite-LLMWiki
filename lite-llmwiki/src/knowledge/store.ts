import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { AppConfig, Source, WikiPage } from "../types.js";

/**
 * KnowledgeStore — 纯文件存储
 *
 * 两个存储层：
 * - raw/    原始材料副本
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

  /** 将源文件复制到 raw/ 目录 */
  saveRaw(source: Source): string {
    const destDir = join(this.config.rawDir, "md");
    mkdirSync(destDir, { recursive: true });
    const cleanId = source.id.replace(/[\/:]/g, "_");
    const destPath = join(destDir, `${cleanId}.md`);

    if (existsSync(source.path)) {
      copyFileSync(source.path, destPath);
    } else {
      const content = [`# ${source.title}`, "", ...source.chunks.map((c) => c.text)].join("\n\n");
      writeFileSync(destPath, content, "utf-8");
    }
    return destPath;
  }

  /** 读取 raw 文件 */
  readRaw(rawId: string): string | null {
    const dir = join(this.config.rawDir, "md");
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
    const dir = join(this.config.wikiDir, "concepts");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => `wiki/concepts/${f}`);
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
    const rawMdDir = join(this.config.rawDir, "md");
    if (existsSync(rawMdDir)) {
      totalSources = readdirSync(rawMdDir).filter((f) => f.endsWith(".md")).length;
    }

    const wikiDir = join(this.config.wikiDir, "concepts");
    const totalNodes = existsSync(wikiDir)
      ? readdirSync(wikiDir).filter((f) => f.endsWith(".md")).length
      : 0;

    return { totalSources, totalNodes };
  }

  // ─── Index & Log ──────────────────────────────────────────────────

  /** 重建 wiki/index.md — 所有页面的目录 */
  rebuildIndex(): string {
    const dir = join(this.config.wikiDir, "concepts");
    if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); return ""; }

    const files = readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_") && !f.startsWith("anchor-"));
    const daFiles = readdirSync(dir).filter((f) => f.startsWith("_devils-advocate-"));
    const anchorFiles = readdirSync(dir).filter((f) => f.startsWith("anchor-"));

    let md = "# Wiki Index\n\n";

    md += `## Concepts (${files.length})\n`;
    for (const f of files) {
      const content = readFileSync(join(dir, f), "utf-8");
      const t = content.match(/^title:\s*(.+)/m);
      const c = content.match(/^confidence:\s*(.+)/m);
      const title = t ? t[1]!.trim() : f.replace(/\.md$/, "");
      const conf = c ? parseFloat(c[1]!) : 0;
      md += `- [${title}](concepts/${f}) — conf: ${conf.toFixed(1)}\n`;
    }

    if (daFiles.length > 0) {
      md += `\n## 反直觉视角 (${daFiles.length})\n`;
      for (const f of daFiles) {
        const content = readFileSync(join(dir, f), "utf-8");
        const t = content.match(/^title:\s*(.+)/m);
        md += `- [${t ? t[1]!.trim() : f}](concepts/${f})\n`;
      }
    }

    if (anchorFiles.length > 0) {
      md += `\n## Anchors (${anchorFiles.length})\n`;
      for (const f of anchorFiles) {
        const content = readFileSync(join(dir, f), "utf-8");
        const t = content.match(/^title:\s*(.+)/m);
        md += `- [${t ? t[1]!.trim() : f}](concepts/${f})\n`;
      }
    }

    md += `\n*Last updated: ${new Date().toISOString()}*\n`;

    const indexPath = join(this.config.wikiDir, "index.md");
    writeFileSync(indexPath, md, "utf-8");
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
