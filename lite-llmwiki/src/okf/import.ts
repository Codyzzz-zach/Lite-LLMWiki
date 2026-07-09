/**
 * import — OKF bundle 导入
 *
 * 读取 OKF bundle → 转换为 wiki 节点 draft → 进入编译管线（audit + gate）。
 *
 * 导入不绕过质量闸门——外部 OKF 内容走 audit + gate 流程（架构设计 §12）。
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { AppConfig, WikiFrontmatter, WikiNodeDraft } from "../types.js";
import { okfTypeToKind } from "./mapping.js";

interface OkfFrontmatter {
	type?: string;
	title?: string;
	description?: string;
	resource?: string;
	tags?: string[];
	timestamp?: string;
	[key: string]: unknown;
}

export function importFromOkf(
	config: AppConfig,
	bundlePath: string,
): { imported: number; skipped: number } {
	const wikiDir = config.wikiDir;
	let imported = 0;
	let skipped = 0;

	// 遍历 bundle 中的所有 .md 文件（跳过 index.md 和 log.md）
	const mdFiles = collectOkfFiles(bundlePath);

	for (const filePath of mdFiles) {
		const content = readFileSync(filePath, "utf-8");
		const { frontmatter, body } = parseOkfDocument(content);
		if (!frontmatter.type) {
			skipped++;
			continue;
		}

		const kind = okfTypeToKind(frontmatter.type);
		const relPath = filePath
			.slice(bundlePath.length)
			.replace(/^\//, "")
			.replace(/\.md$/, "");
		const title = frontmatter.title ?? basename(filePath, ".md");
		const nodeId = sanitizeNodeId(relPath);

		const draft: WikiNodeDraft = {
			nodeId,
			kind,
			filePath: `wiki/${kind}s/${nodeId.replace(/\//g, "-")}.md`,
			frontmatter: {
				title,
				kind,
				sourceIds: frontmatter.resource ? [frontmatter.resource] : [],
				tags: frontmatter.tags,
				confidence: 0.5, // 外部导入设为中等置信度
				status: "draft", // 初始为 draft——需通过 audit
				createdAt: frontmatter.timestamp ?? new Date().toISOString(),
				reflowOrigin: `okf:${bundlePath}`,
			},
			claim: extractClaim(body),
			evidence: [],
		};

		// 写入 wiki
		const wikiDirPath = join(wikiDir, `${kind}s`);
		mkdirSync(wikiDirPath, { recursive: true });
		const outPath = join(wikiDirPath, `${nodeId.replace(/\//g, "-")}.md`);

		const yaml = serializeToFrontmatter(draft);
		writeFileSync(outPath, yaml, "utf-8");
		imported++;
	}

	return { imported, skipped };
}

/** 遍历 OKF bundle 中所有概念 .md 文件 */
function collectOkfFiles(bundlePath: string): string[] {
	const results: string[] = [];
	const stack = [bundlePath];
	const skipNames = new Set(["index.md", "log.md"]);

	while (stack.length > 0) {
		const dir = stack.pop()!;
		if (!existsSync(dir)) continue;
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				stack.push(fullPath);
			} else if (entry.name.endsWith(".md") && !skipNames.has(entry.name)) {
				results.push(fullPath);
			}
		}
	}

	return results;
}

/** 解析 OKF 文档 frontmatter + body */
function parseOkfDocument(content: string): {
	frontmatter: OkfFrontmatter;
	body: string;
} {
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!fmMatch) return { frontmatter: {}, body: content };

	const frontmatter: OkfFrontmatter = {};
	const lines = fmMatch[1]!.split("\n");
	let currentArrayKey: string | null = null;

	for (const line of lines) {
		const arrayItem = line.match(/^\s*-\s+(.+)$/);
		if (arrayItem && currentArrayKey) {
			const existing = frontmatter[currentArrayKey];
			if (Array.isArray(existing)) {
				existing.push(arrayItem[1]!.trim());
			}
			continue;
		}
		const colon = line.indexOf(":");
		if (colon <= 0) continue;
		const key = line.slice(0, colon).trim();
		const val = line.slice(colon + 1).trim();
		if (!key) continue;

		if (val.startsWith("[") && val.endsWith("]")) {
			// 数组: tags: [a, b, c]
			const inner = val.slice(1, -1);
			frontmatter[key] = inner
				.split(",")
				.map((s) => s.trim().replace(/^["']|["']$/g, ""))
				.filter(Boolean);
		} else if (val) {
			frontmatter[key] = val.replace(/^["']|["']$/g, "");
		} else {
			frontmatter[key] = [];
			currentArrayKey = key;
		}
	}

	const bodyStart = content.indexOf("\n---\n", fmMatch[0].length);
	const body = bodyStart >= 0 ? content.slice(bodyStart + 5).trim() : "";

	return { frontmatter, body };
}

/** 从 body 提取 claim（第一个非空段落） */
function extractClaim(body: string): string {
	const lines = body.split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		if (
			trimmed &&
			!trimmed.startsWith("#") &&
			!trimmed.startsWith("-") &&
			!trimmed.startsWith("*")
		) {
			return trimmed.slice(0, 500);
		}
	}
	return body.slice(0, 500).trim();
}

/** 将 nodeId 中的路径字符替换为安全格式 */
function sanitizeNodeId(path: string): string {
	return path
		.replace(/[^a-zA-Z0-9一-鿿_\-/]/g, "-")
		.replace(/\/+/g, "/")
		.replace(/^\/|\/$/g, "")
		.toLowerCase()
		.slice(0, 80);
}

/** 序列化 WikiNodeDraft 为 YAML frontmatter + markdown body */
function serializeToFrontmatter(draft: WikiNodeDraft): string {
	const fm = draft.frontmatter;
	const lines: string[] = ["---"];
	lines.push(`nodeId: ${draft.nodeId}`);
	lines.push(`kind: ${draft.kind}`);
	lines.push(`title: ${fm.title}`);
	if (fm.sourceIds && fm.sourceIds.length > 0) {
		lines.push("sourceIds:");
		for (const s of fm.sourceIds) lines.push(`  - ${s}`);
	}
	if (fm.tags && fm.tags.length > 0) {
		lines.push(`tags: [${fm.tags.join(", ")}]`);
	}
	lines.push(`confidence: ${fm.confidence ?? 0.5}`);
	lines.push(`status: ${fm.status ?? "draft"}`);
	if (fm.createdAt) lines.push(`createdAt: ${fm.createdAt}`);
	if (fm.reflowOrigin) lines.push(`reflowOrigin: ${fm.reflowOrigin}`);
	lines.push("---");
	lines.push("");
	lines.push("## Claim");
	lines.push(draft.claim);
	lines.push("");

	return lines.join("\n");
}
