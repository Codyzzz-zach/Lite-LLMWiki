/**
 * export — OKF bundle 导出
 *
 * 读取 wiki/*.md → 转换为 OKF v0.1 格式 → 写入目标目录。
 *
 * 映射规则：
 * - kind → type
 * - createdAt/updatedAt → timestamp
 * - tags → tags（零差距）
 * - title → title（零差距）
 * - ## Claim / ## Evidence / ## Interpretation → body
 * - ## Links → 交叉引用（OKF markdown links）
 * - 生成 index.md + log.md
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { parseWikiContent } from "../knowledge/wiki-parser.js";
import type { AppConfig } from "../types.js";
import { kindToOkfType } from "./mapping.js";

// ─── 类型 ──────────────────────────────────────────────────────────

interface OkfConcept {
	path: string; // 相对于 bundle root 的路径
	type: string;
	title: string;
	description: string;
	tags: string[];
	timestamp: string;
	body: string;
}

// ─── 主入口 ────────────────────────────────────────────────────────

export function exportToOkf(
	config: AppConfig,
	outDir: string,
): { count: number; bundlePath: string } {
	const wikiDir = config.wikiDir;
	const wikiDirs = [
		"concepts",
		"claims",
		"methods",
		"cases",
		"equations",
		"questions",
		"insights",
		"anchors",
		"counters",
	];

	const concepts: OkfConcept[] = [];
	const okfBase = join(outDir, "okf-bundle");
	mkdirSync(okfBase, { recursive: true });

	// 1. 收集所有 wiki 节点
	for (const dir of wikiDirs) {
		const dirPath = join(wikiDir, dir);
		if (!existsSync(dirPath)) continue;

		const files = readdirSync(dirPath).filter((f) => f.endsWith(".md"));
		for (const file of files) {
			const fullPath = join(dirPath, file);
			const content = readFileSync(fullPath, "utf-8");
			const parsed = parseWikiContent(content, `wiki/${dir}/${file}`);
			const fm = parsed.frontmatter;

			if (!fm.nodeId) continue;

			// OKF uses /types/name.md path convention
			const okfDir = dir; // concepts/ → concepts/, counters/ → counters/
			const okfPath = `${okfDir}/${file}`;

			// Build OKF body
			const bodyParts: string[] = [];
			if (parsed.sections.claim) {
				bodyParts.push(`## Claim\n\n${parsed.sections.claim}\n`);
			}
			if (parsed.sections.interpretation) {
				bodyParts.push(
					`## Interpretation\n\n${parsed.sections.interpretation}\n`,
				);
			}
			if (parsed.sections.evidence && parsed.sections.evidence.length > 0) {
				bodyParts.push("## Evidence\n");
				for (const ev of parsed.sections.evidence) {
					bodyParts.push(`- ${ev}`);
				}
				bodyParts.push("");
			}
			if (parsed.sections.limits && parsed.sections.limits.length > 0) {
				bodyParts.push("## Limits\n");
				for (const limit of parsed.sections.limits) {
					bodyParts.push(`- ${limit}`);
				}
				bodyParts.push("");
			}
			// Links → OKF cross-links
			if (parsed.sections.links && parsed.sections.links.length > 0) {
				bodyParts.push("## Links\n");
				for (const link of parsed.sections.links) {
					const cleanLink = link.replace(/^\[\[|\]\]$/g, "");
					bodyParts.push(`- [${cleanLink}](/wiki/${cleanLink}.md)`);
				}
				bodyParts.push("");
			}
			// Audit Notes as footer
			if (parsed.sections.auditNotes) {
				bodyParts.push(`## Audit Notes\n\n${parsed.sections.auditNotes}\n`);
			}

			const description = fm.title ?? file.replace(/\.md$/, "");
			const tags = [...(fm.tags ?? [])];
			if (fm.auditStatus) tags.push(`audit:${fm.auditStatus}`);

			concepts.push({
				path: okfPath,
				type: kindToOkfType(fm.kind ?? "concept"),
				title: description,
				description: parsed.sections.claim?.slice(0, 120) ?? description,
				tags,
				timestamp: fm.updatedAt ?? fm.createdAt ?? new Date().toISOString(),
				body: bodyParts.join("\n"),
			});
		}
	}

	// 2. 按目录分组
	const byDir = new Map<string, OkfConcept[]>();
	for (const c of concepts) {
		const d = dirname(c.path);
		if (!byDir.has(d)) byDir.set(d, []);
		byDir.get(d)!.push(c);
	}

	// 3. 写入概念文件 + index.md
	for (const [dir, items] of byDir) {
		const dirPath = join(okfBase, dir);
		mkdirSync(dirPath, { recursive: true });

		const indexLines: string[] = [`# ${dir}`];
		indexLines.push("");

		for (const item of items) {
			// 写入概念文件
			const yaml = [
				"---",
				`type: ${item.type}`,
				`title: ${item.title}`,
				`description: ${item.description}`,
				item.tags.length > 0 ? `tags: [${item.tags.join(", ")}]` : "",
				`timestamp: ${item.timestamp}`,
				"---",
				"",
				item.body,
			]
				.filter((l) => l !== "")
				.join("\n");

			writeFileSync(
				join(dirPath, item.path.split("/").pop()!),
				yaml + "\n",
				"utf-8",
			);

			// index entry
			const fileName = item.path.split("/").pop()!;
			indexLines.push(`* [${item.title}](${fileName}) - ${item.description}`);
		}
		indexLines.push("");
		writeFileSync(join(dirPath, "index.md"), indexLines.join("\n"), "utf-8");
	}

	// 4. 根 index.md
	const rootIndex: string[] = ["# OKF Bundle (exported from LiteWikiagent)"];
	rootIndex.push("");
	rootIndex.push(`Exported at ${new Date().toISOString()}`);
	rootIndex.push(`Total concepts: ${concepts.length}`);
	rootIndex.push("");
	for (const [dir, items] of byDir) {
		rootIndex.push(`## ${dir} (${items.length})`);
		for (const item of items.slice(0, 5)) {
			const fileName = item.path.split("/").pop()!;
			rootIndex.push(
				`* [${item.title}](${dir}/${fileName}) - ${item.description}`,
			);
		}
		if (items.length > 5) {
			rootIndex.push(
				`* … and ${items.length - 5} more — see [${dir}/index.md](${dir}/index.md)`,
			);
		}
		rootIndex.push("");
	}
	writeFileSync(join(okfBase, "index.md"), rootIndex.join("\n"), "utf-8");

	// 5. log.md
	const logLines = [
		"# Bundle Update Log",
		"",
		`## ${new Date().toISOString().split("T")[0]}`,
		`* **Export**: Exported ${concepts.length} concepts from LiteWikiagent wiki to OKF bundle.`,
		"",
	];
	writeFileSync(join(okfBase, "log.md"), logLines.join("\n"), "utf-8");

	return { count: concepts.length, bundlePath: okfBase };
}
