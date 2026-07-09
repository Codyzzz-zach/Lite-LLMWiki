import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { estimateTokens } from "../ingest/loader.js";
import type {
	AppConfig,
	Chunk,
	Source,
	WikiNodeDraft,
	WikiPage,
} from "../types.js";
import { ChaseNotFoundError, readChaseChunks } from "./chase.js";
import { renderWikiNode } from "./render.js";
import { WIKI_NODE_DIRS, parseWikiContent } from "./wiki-parser.js";

/**
 * KnowledgeStore — 纯文件存储
 *
 * 三个存储层：
 * - raw/original/<format>/  原始材料副本
 * - raw/chase/              清洗后的 Markdown 中间层
 * - wiki/   编译产物（Markdown）
 *
 * v6 改造（plan 6.3）：
 * - 复用 wiki-parser.ts 解析所有 wiki 页面（消除自带的 frontmatter / chunk parser）
 * - 复用 chase.ts 解析 chunk marker（兼容 v5 冒号 + v6 空格格式）
 * - 复用 wiki-parser.ts 的 WIKI_NODE_DIRS 常量
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
				sourcePath === originalRoot ||
				sourcePath.startsWith(`${originalRoot}${sep}`);

			if (!isAlreadyOriginal) {
				const sourceStat = statSync(originalSource);
				const sourceExt = sourceStat.isDirectory()
					? source.type
					: extname(originalSource).replace(/^\./, "").toLowerCase() ||
						"unknown";
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

		const bodyContent =
			source.body || source.chunks.map((c) => c.text).join("\n\n");
		const chunkMarkers =
			source.chunks.length > 0
				? "\n" +
					source.chunks
						.map(
							(c) =>
								`<!-- chunk:${c.index + 1} id=${c.id} charStart=${c.charStart} charEnd=${c.charEnd} -->\n${c.text}\n<!-- /chunk:${c.index + 1} -->`,
						)
						.join("\n")
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

	/**
	 * 从 chase 文件解析 chunk 边界
	 *
	 * 委托给 chase.ts（兼容 v5 `<!-- chunk:N -->` + v6 `<!-- chunk N -->`）。
	 * 走 v5 闭合注释 `<!-- /chunk:N -->` 提取 text 区间。
	 * 无闭合注释时回退到 chase.ts 的 `readChaseChunks`（按 marker 切分）。
	 */
	readChunks(rawId: string): Chunk[] | null {
		const content = this.readRaw(rawId);
		if (!content) return null;

		// 1. 尝试 v5 闭合注释格式（保留旧行为：保留 id/charStart/charEnd）
		const closedRe =
			/<!--\s*chunk:(\d+)([^>]*?)-->\s*\n?([\s\S]*?)\n?\s*<!--\s*\/chunk:\1\s*-->/g;
		const chunks: Chunk[] = [];
		let match: RegExpExecArray | null;
		while ((match = closedRe.exec(content)) !== null) {
			const index = Number.parseInt(match[1]!, 10);
			const attrs = match[2] ?? "";
			const text = match[3] ?? "";
			const idMatch = attrs.match(/id=([^\s]+)/);
			const charStartMatch = attrs.match(/charStart=(\d+)/);
			const charEndMatch = attrs.match(/charEnd=(\d+)/);
			const cleanId = rawId.replace(/[\/:]/g, "_");
			chunks.push({
				id: idMatch?.[1] ?? `${cleanId}-chunk${index}`,
				index,
				text,
				tokenEstimate: estimateTokens(text),
				charStart: charStartMatch ? Number.parseInt(charStartMatch[1]!, 10) : 0,
				charEnd: charEndMatch ? Number.parseInt(charEndMatch[1]!, 10) : 0,
			});
		}
		if (chunks.length > 0) {
			return chunks.sort((a, b) => a.index - b.index);
		}

		// 2. 回退：使用 chase.ts 的 readChaseChunks（v6 空格格式 / 任意 chunk marker）
		try {
			const chaseChunks = readChaseChunks(this.config, [
				`${rawId.replace(/[\/:]/g, "_")}.md`,
			]);
			const cleanId = rawId.replace(/[\/:]/g, "_");
			return chaseChunks.map((c) => ({
				id: `${cleanId}-chunk${c.index}`,
				index: c.index,
				text: c.text,
				tokenEstimate: estimateTokens(c.text),
				charStart: 0,
				charEnd: 0,
			}));
		} catch (e) {
			if (e instanceof ChaseNotFoundError) return null;
			throw e;
		}
	}

	// ─── Wiki Layer ──────────────────────────────────────────────────

	/** 将 wiki 页面写入 wiki/ 目录，支持 append 模式 */
	saveWikiPage(page: WikiPage): string {
		// filePath 格式为 "wiki/concepts/xxx.md"，去掉 "wiki/" 前缀再拼 wikiDir
		const relPath = page.filePath.startsWith("wiki/")
			? page.filePath.slice(5)
			: page.filePath;
		if (!relPath)
			throw new Error(`saveWikiPage: empty filePath for node "${page.nodeId}"`);
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
		const content = ["---", ...frontmatterLines, "---", "", page.body].join(
			"\n",
		);

		writeFileSync(fullPath, content, "utf-8");
		return fullPath;
	}

	/** 渲染并保存 wiki 节点（v5 + v6 frontmatter + v6 sections） */
	saveWikiNode(draft: WikiNodeDraft): string {
		const content = renderWikiNode({
			...draft,
			frontmatter: {
				...draft.frontmatter,
				sourceChase: draft.frontmatter.sourceChase?.length
					? draft.frontmatter.sourceChase
					: (draft.frontmatter.sourceIds?.map(
							(sourceId) => `raw/chase/${sourceId.replace(/[\/:]/g, "_")}.md`,
						) ?? []),
			},
		});
		const relPath = draft.filePath.startsWith("wiki/")
			? draft.filePath.slice(5)
			: draft.filePath;
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

	/** 列出所有 wiki 文件（扫 8 个目录） */
	listWikiPages(): string[] {
		return WIKI_NODE_DIRS.flatMap((dirName) => {
			const dir = join(this.config.wikiDir, dirName);
			if (!existsSync(dir)) return [];
			return readdirSync(dir)
				.filter((f) => f.endsWith(".md"))
				.map((f) => `wiki/${dirName}/${f}`);
		});
	}

	/** 找到与给定命题相关的已有 wiki 页面（用于 compile 阶段的 cross-page update）*/
	findRelatedPages(
		propositions: Array<{ claim: string }>,
	): Array<{ filePath: string; title: string; summary: string }> {
		const results: Array<{ filePath: string; title: string; summary: string }> =
			[];

		// 提取关键词
		const propText = propositions.map((p) => p.claim).join(" ");
		const keywords = new Set<string>();
		for (const term of propText.split(
			/[\s,，。！？、；：""''（）\(\)\[\]【】]+/,
		)) {
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

		// 扫所有 wiki 目录（用 parseWikiContent 解析）
		for (const dirName of WIKI_NODE_DIRS) {
			const dir = join(this.config.wikiDir, dirName);
			if (!existsSync(dir)) continue;
			const files = readdirSync(dir).filter(
				(f) =>
					f.endsWith(".md") &&
					!f.startsWith("_devils-") &&
					!f.startsWith("anchor-"),
			);
			for (const file of files) {
				const fullPath = join(dir, file);
				const content = readFileSync(fullPath, "utf-8");
				const lower = content.toLowerCase();
				const hits = kwList.filter((w) => lower.includes(w)).length;
				if (hits >= 2) {
					// 复用 parseWikiContent 提取 title
					const parsed = parseWikiContent(content, fullPath);
					const summary =
						parsed.sections.claim.slice(0, 200) ||
						parsed.sections.evidence.join(" ").slice(0, 200);
					results.push({
						filePath: `wiki/${dirName}/${file}`,
						title: parsed.title,
						summary,
					});
				}
			}
		}

		return results.slice(0, 8);
	}

	// ─── 统计 ────────────────────────────────────────────────────────

	getStats(): { totalSources: number; totalNodes: number } {
		let totalSources = 0;
		const rawChaseDir = join(this.config.rawDir, "chase");
		if (existsSync(rawChaseDir)) {
			totalSources = readdirSync(rawChaseDir).filter((f) =>
				f.endsWith(".md"),
			).length;
		}

		const totalNodes = this.listWikiPages().length;

		return { totalSources, totalNodes };
	}

	// ─── Index & Log ──────────────────────────────────────────────────

	/**
	 * 重建 wiki/index.md + wiki/index.json
	 * v6 改造：使用 parseWikiContent 统一解析（plan 6.3 漏改项 S1）
	 */
	rebuildIndex(): string {
		const conceptsDir = join(this.config.wikiDir, "concepts");
		if (!existsSync(conceptsDir)) mkdirSync(conceptsDir, { recursive: true });
		const pagePaths = this.listWikiPages();

		// ── index.md（人类可读） ──
		let md = "# Wiki Index\n\n";
		md += `## Nodes (${pagePaths.length})\n`;
		for (const filePath of pagePaths) {
			const fullPath = this.resolveWikiFullPath(filePath);
			const content = fullPath ? readFileSyncSafe(fullPath) : null;
			const t = content ? content.match(/^title:\s*(.+)/m) : null;
			const c = content ? content.match(/^confidence:\s*(.+)/m) : null;
			const title = t ? t[1]!.trim() : filePath.replace(/\.md$/, "");
			const conf = c ? Number.parseFloat(c[1]!) : 0;
			md += `- [${title}](${filePath.replace(/^wiki\//, "")}) — conf: ${conf.toFixed(1)}\n`;
		}
		md += `\n*Last updated: ${new Date().toISOString()}*\n`;

		const indexPath = join(this.config.wikiDir, "index.md");
		writeFileSync(indexPath, md, "utf-8");

		// ── index.json（机器 manifest，v6 字段） ──
		type IndexEntry = {
			nodeId: string;
			kind: string;
			title: string;
			filePath: string;
			sourceIds: string[];
			sourceChase: string[];
			propRefs: string[];
			tags: string[];
			related: string[];
			confidence: number;
			status: string;
			updatedAt: string;
			// v6 字段（Phase 2 IndexEntryV6 的种子）
			auditStatus?: string;
			auditScore?: number;
			claimType?: string;
			inferenceLevel?: string;
			claimHash?: string;
			boardRoles?: string[];
		};

		const entries: IndexEntry[] = [];
		for (const filePath of pagePaths) {
			const fullPath = this.resolveWikiFullPath(filePath);
			if (!fullPath) continue;
			const content = readFileSyncSafe(fullPath);
			if (content === null) continue;
			const parsed = parseWikiContent(content, fullPath);
			const fm = parsed.frontmatter;

			entries.push({
				nodeId:
					parsed.nodeId || filePath.replace(/^wiki\//, "").replace(/\.md$/, ""),
				kind: parsed.kind,
				title: parsed.title,
				filePath,
				sourceIds: fm.sourceIds ?? [],
				sourceChase: fm.sourceChase ?? [],
				propRefs: fm.propRefs ?? [],
				tags: fm.tags ?? [],
				related: fm.related ?? [],
				confidence: fm.confidence ?? 0,
				status: fm.status ?? "needs_review",
				updatedAt: fm.updatedAt ?? fm.createdAt ?? new Date().toISOString(),
				// v6 字段（如有）
				auditStatus: fm.auditStatus,
				auditScore: fm.auditScore,
				claimType: fm.claimType,
				inferenceLevel: fm.inferenceLevel,
				claimHash: fm.claimHash,
				boardRoles: fm.boardRoles,
			});
		}

		const jsonPath = join(this.config.wikiDir, "index.json");
		writeFileSync(jsonPath, JSON.stringify(entries, null, 2), "utf-8");

		return indexPath;
	}

	/** 追加 log.md 记录 */
	appendLog(entry: {
		title: string;
		source: string;
		anchor?: string;
		confirmed: number;
		total: number;
		newPages: number;
		updatedPages: number;
	}): string {
		const logPath = join(this.config.wikiDir, "log.md");
		const now = new Date().toISOString().replace("T", " ").slice(0, 19);

		const lines =
			[
				`## [${now}] ingest | ${entry.title.slice(0, 60)}`,
				`- source: ${entry.source}`,
				entry.anchor ? `- anchor: "${entry.anchor.slice(0, 80)}"` : "",
				`- confirmed: ${entry.confirmed}/${entry.total} propositions`,
				`- pages: ${entry.newPages} new, ${entry.updatedPages} updated`,
				"",
			]
				.filter(Boolean)
				.join("\n") + "\n";

		mkdirSync(dirname(logPath), { recursive: true });
		writeFileSync(logPath, lines, { encoding: "utf-8", flag: "a" });
		return logPath;
	}

	// ─── 内部工具 ────────────────────────────────────────────────────

	private resolveWikiFullPath(filePath: string): string | null {
		const relPath = filePath.startsWith("wiki/") ? filePath.slice(5) : filePath;
		const fullPath = relPath.startsWith("/")
			? relPath
			: join(this.config.wikiDir, relPath);
		return existsSync(fullPath) ? fullPath : null;
	}
}

function readFileSyncSafe(p: string): string | null {
	try {
		return readFileSync(p, "utf-8");
	} catch {
		return null;
	}
}
