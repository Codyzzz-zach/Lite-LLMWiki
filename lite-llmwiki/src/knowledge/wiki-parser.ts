/**
 * wiki-parser — 统一 wiki 页面解析器
 *
 * 将 v5/v6 wiki Markdown 文件解析为 ParsedWikiNode 结构。
 * 消除 audit / search / inspire 三处独立的 parser 实现。
 *
 * 设计要点：
 * - `WIKI_DIR_TO_KIND` 把目录名（复数）映射到 WikiKind（单数）
 * - `parseFrontmatter` 保持最小字符串解析（不做完整 YAML）
 * - `parseWikiContent` 出口做类型归一化（tags 拆分、chunkRefs→number、kind 校验）
 * - 共享 `parseStringList` / `parseChunkRefs` / `scalar` / `extractRawId` 工具
 *   供 audit 等模块复用，避免重新实现。
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	AuditStatus,
	BoardRole,
	ClaimType,
	InferenceLevel,
	ParsedWikiNode,
	WikiFrontmatter,
	WikiKind,
} from "../types.js";
import { computeClaimHash } from "./manifest.js";

// ─── 公开常量 ──────────────────────────────────────────────────────

/** Wiki 节点目录名（复数，与 WikiKind 单数对应） */
export const WIKI_NODE_DIRS: string[] = [
	"concepts",
	"methods",
	"cases",
	"equations",
	"questions",
	"insights",
	"anchors",
	"counters",
];

/** 目录名（复数） → WikiKind（单数）映射。`claim` 只能来自 frontmatter，没有对应目录。 */
const WIKI_DIR_TO_KIND: Readonly<Record<string, WikiKind>> = {
	concepts: "concept",
	methods: "method",
	cases: "case",
	equations: "equation",
	questions: "question",
	insights: "insight",
	anchors: "anchor",
	counters: "counter",
};

/** 完整的 WikiKind 取值（含 `claim`，仅来自 frontmatter） */
const WIKI_KIND_VALUES: readonly WikiKind[] = [
	"concept",
	"claim",
	"method",
	"case",
	"equation",
	"question",
	"insight",
	"anchor",
	"counter",
];

function isValidWikiKind(s: string): s is WikiKind {
	return (WIKI_KIND_VALUES as readonly string[]).includes(s);
}

// ─── 公开入口 ──────────────────────────────────────────────────────

/** 解析 wiki 文件内容为 ParsedWikiNode */
export function parseWikiContent(
	content: string,
	filePath: string,
): ParsedWikiNode {
	const fm = parseFrontmatter(content);
	const body = extractBody(content);
	const sections = parseBodySections(body);

	const nodeId = scalar(fm["nodeId"]) ?? "";
	const rawKind = scalar(fm["kind"]) ?? inferKindFromPath(filePath);
	const kind: WikiKind = isValidWikiKind(rawKind) ? rawKind : "concept";
	const title = scalar(fm["title"]) ?? (nodeId || filePath);

	return {
		nodeId,
		kind,
		title,
		filePath,
		frontmatter: normalizeFrontmatter(
			fm,
			kind,
			title,
			nodeId,
			sections.Claim ?? "",
		),
		sections: {
			claim: sections["Claim"] ?? "",
			evidence: splitLines(sections["Evidence"]),
			interpretation: sections["Interpretation"] ?? "",
			useFor: splitLines(sections["Use For"]),
			limits: splitLines(sections["Limits"]),
			links: splitLines(sections["Links"]),
			auditNotes: sections["Audit Notes"] ?? "",
			boardUse: splitLines(sections["Board Use"]),
		},
		fullText: content,
		isLegacy: !nodeId,
	};
}

/** 从文件读取并解析 */
export function parseWikiFile(filePath: string): ParsedWikiNode | null {
	try {
		return parseWikiContent(readFileSync(filePath, "utf-8"), filePath);
	} catch {
		return null;
	}
}

/** 遍历 wiki 目录下所有 .md 文件 */
export function scanWikiFiles(wikiDir: string): string[] {
	const files: string[] = [];
	for (const dir of WIKI_NODE_DIRS) {
		const fullDir = join(wikiDir, dir);
		if (!existsSync(fullDir)) continue;
		try {
			for (const entry of readdirSync(fullDir)) {
				if (entry.endsWith(".md")) {
					files.push(join(fullDir, entry));
				}
			}
		} catch {
			/* skip unreadable dirs */
		}
	}
	return files;
}

/** 按文件名目录推断 kind（仅基于已知的 8 个目录；`claim` 只能来自 frontmatter） */
export function inferKindFromPath(filePath: string): WikiKind {
	for (const [dir, kind] of Object.entries(WIKI_DIR_TO_KIND)) {
		if (filePath.includes(`/${dir}/`)) return kind;
	}
	return "concept";
}

// ─── 共享工具（供 audit 等模块使用） ─────────────────────────────

/** 取第一个标量值（数组时取 [0]，未定义时返回 undefined） */
export function scalar(
	value: string | string[] | undefined,
): string | undefined {
	if (value === undefined) return undefined;
	return Array.isArray(value) ? value[0] : value;
}

/** 解析字符串列表（支持数组、`[a, b]`、逗号分隔） */
export function parseStringList(raw: string | string[] | undefined): string[] {
	if (!raw) return [];
	if (Array.isArray(raw)) return raw;
	return raw
		.replace(/[\[\]]/g, "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

/** 解析 chunkRefs 数字数组（兼容字符串、数组、`[1, 2]`） */
export function parseChunkRefs(raw: string | string[] | undefined): number[] {
	if (!raw) return [];
	const values = Array.isArray(raw)
		? raw
		: raw.replace(/[\[\]]/g, "").split(",");
	return values
		.map((s) => Number.parseInt(s.trim(), 10))
		.filter((n) => !isNaN(n));
}

/** 从 chase 文件路径提取 raw id（去掉 .md 与目录前缀） */
export function extractRawId(chaseVal: string): string {
	const basename = chaseVal.split("/").pop() ?? chaseVal;
	return basename.replace(/\.md$/, "");
}

// ─── 归一化 frontmatter ────────────────────────────────────────────

/** 把 raw frontmatter 归一化为带类型的 WikiFrontmatter */
function normalizeFrontmatter(
	raw: Record<string, string | string[]>,
	kind: WikiKind,
	title: string,
	nodeId: string,
	claim: string,
): WikiFrontmatter {
	const out: WikiFrontmatter = { title, kind };
	if (nodeId) out.nodeId = nodeId;
	const src = scalar(raw["source"]);
	if (src) out.source = src;
	const sourceIds = parseStringList(raw["sourceIds"]);
	if (sourceIds.length > 0) out.sourceIds = sourceIds;
	const sourceChase = parseStringList(raw["sourceChase"]);
	if (sourceChase.length > 0) out.sourceChase = sourceChase;
	const chunkRefs = parseChunkRefs(raw["chunkRefs"]);
	if (chunkRefs.length > 0)
		out.propRefs = [...(out.propRefs ?? []), ...chunkRefs.map(String)];
	const confidence = parseNumber(scalar(raw["confidence"]));
	if (confidence !== undefined) out.confidence = confidence;
	const status = scalar(raw["status"]);
	if (
		status === "draft" ||
		status === "verified" ||
		status === "needs_review" ||
		status === "legacy"
	) {
		out.status = status;
	}
	const createdAt = scalar(raw["createdAt"]);
	if (createdAt) out.createdAt = createdAt;
	const updatedAt = scalar(raw["updatedAt"]);
	if (updatedAt) out.updatedAt = updatedAt;
	const tags = parseTags(raw["tags"]);
	if (tags && tags.length > 0) out.tags = tags;
	const hypothesis = scalar(raw["hypothesis"]);
	if (hypothesis) out.hypothesis = hypothesis;
	const hypothesisTitle = scalar(raw["hypothesisTitle"]);
	if (hypothesisTitle) out.hypothesisTitle = hypothesisTitle;
	const related = parseStringList(raw["related"]);
	if (related.length > 0) out.related = related;
	// v6
	// auditStatus 默认 "pending"（spec 6.2 + plan 6.7 "v6 字段缺失时给默认值"）
	const auditStatusRaw = scalar(raw["auditStatus"]);
	if (auditStatusRaw !== undefined) {
		const parsed = parseAuditStatus(auditStatusRaw);
		out.auditStatus = parsed ?? "pending";
	} else {
		out.auditStatus = "pending";
	}
	const auditScore = parseNumber(scalar(raw["auditScore"]));
	if (auditScore !== undefined) out.auditScore = auditScore;
	const claimType = parseClaimType(scalar(raw["claimType"]));
	if (claimType) out.claimType = claimType;
	const inferenceLevel = parseInferenceLevel(scalar(raw["inferenceLevel"]));
	if (inferenceLevel) out.inferenceLevel = inferenceLevel;
	const propRefs = parseStringList(raw["propRefs"]);
	if (propRefs.length > 0) out.propRefs = propRefs;
	// claimHash: 显式声明优先；否则从 claim 自动计算
	const explicitClaimHash = scalar(raw["claimHash"]);
	if (explicitClaimHash) {
		out.claimHash = explicitClaimHash;
	} else if (claim) {
		out.claimHash = computeClaimHash(claim);
	}
	const boardRoles = parseBoardRoles(raw["boardRoles"]);
	if (boardRoles) out.boardRoles = boardRoles;
	// edges: JSON 字符串（YAML 解析器限制，嵌套对象以 JSON 编码）
	const edgesRaw = raw["edges"];
	if (typeof edgesRaw === "string" && edgesRaw.trim().length > 0) {
		try {
			out.edges = JSON.parse(edgesRaw);
		} catch {
			/* ignore parse errors */
		}
	}
	return out;
}

function parseTags(raw: string | string[] | undefined): string[] | undefined {
	if (raw === undefined) return undefined;
	if (Array.isArray(raw)) return raw.filter(Boolean);
	if (raw.includes(",")) return raw.split(/,\s*/).filter(Boolean);
	return raw ? [raw] : undefined;
}

function parseNumber(s: string | undefined): number | undefined {
	if (s === undefined) return undefined;
	const n = Number.parseFloat(s);
	return isNaN(n) ? undefined : n;
}

function parseAuditStatus(s: string | undefined): AuditStatus | undefined {
	if (!s) return undefined;
	const valid: AuditStatus[] = ["pending", "passed", "warning", "failed"];
	return valid.includes(s as AuditStatus) ? (s as AuditStatus) : undefined;
}

function parseBoardRoles(
	raw: string | string[] | undefined,
): BoardRole[] | undefined {
	const list = parseStringList(raw);
	if (list.length === 0) return undefined;
	const valid: BoardRole[] = [
		"evidence",
		"concept",
		"method",
		"case",
		"limit",
		"counter",
		"question",
		"anchor",
		"bridge",
	];
	const set = new Set<BoardRole>();
	for (const r of list) {
		if (valid.includes(r as BoardRole)) set.add(r as BoardRole);
	}
	return set.size > 0 ? Array.from(set) : undefined;
}

function parseClaimType(s: string | undefined): ClaimType | undefined {
	if (!s) return undefined;
	const valid: ClaimType[] = [
		"source_claim",
		"interpretation",
		"application",
		"analogy",
		"question",
		"counter",
	];
	return valid.includes(s as ClaimType) ? (s as ClaimType) : undefined;
}

function parseInferenceLevel(
	s: string | undefined,
): InferenceLevel | undefined {
	if (!s) return undefined;
	const valid: InferenceLevel[] = ["none", "light", "medium", "strong"];
	return valid.includes(s as InferenceLevel)
		? (s as InferenceLevel)
		: undefined;
}

// ─── Frontmatter 解析 ──────────────────────────────────────────────

/**
 * 解析 frontmatter（`---\n...\n---` 中的 key: value 行）
 * - 仅支持简单 key-value 与多行 `- item` 数组
 * - 数字、布尔、引号均按字符串保留（类型归一化在 normalizeFrontmatter 完成）
 */
function parseFrontmatter(content: string): Record<string, string | string[]> {
	const fm: Record<string, string | string[]> = {};
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return fm;
	let currentArrayKey: string | null = null;
	for (const line of match[1]!.split("\n")) {
		const arrayItem = line.match(/^\s*-\s+(.+)$/);
		if (arrayItem && currentArrayKey) {
			const current = fm[currentArrayKey];
			fm[currentArrayKey] = [
				...(Array.isArray(current) ? current : []),
				arrayItem[1]!.trim(),
			];
			continue;
		}
		const colon = line.indexOf(":");
		if (colon <= 0) continue;
		const key = line.slice(0, colon).trim();
		let val = line.slice(colon + 1).trim();
		if (!key) continue;
		// 剥引号（双引号 / 单引号）
		if (val.length >= 2) {
			const first = val[0]!;
			const last = val[val.length - 1]!;
			if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
				val = val.slice(1, -1);
			}
		}
		if (val) {
			fm[key] = val;
			currentArrayKey = null;
		} else {
			fm[key] = [];
			currentArrayKey = key;
		}
	}
	return fm;
}

// ─── Body 解析 ────────────────────────────────────────────────────

function extractBody(content: string): string {
	const idx = content.search(/\n---\n/);
	return idx >= 0 ? content.slice(idx + 5) : content;
}

function parseBodySections(body: string): Record<string, string> {
	const sections: Record<string, string> = {};
	const lines = body.split("\n");
	let curSec: string | null = null;
	const buf: string[] = [];

	for (const line of lines) {
		const headerMatch = line.match(/^##\s+(.+)$/);
		if (headerMatch) {
			if (curSec) sections[curSec] = buf.join("\n").trim();
			curSec = headerMatch[1]!.trim();
			buf.length = 0;
		} else if (curSec) {
			buf.push(line);
		}
	}
	if (curSec) sections[curSec] = buf.join("\n").trim();

	return sections;
}

// ─── Frontmatter 写回 ─────────────────────────────────────────────

/** 更新 wiki 文件的 frontmatter 字段，不修改 body 内容。 */
export function updateFrontmatter(
	filePath: string,
	updates: Record<string, unknown>,
): void {
	const content = readFileSync(filePath, "utf-8");
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!fmMatch) {
		const newFm = serializeFrontmatterBlock(updates);
		writeFileSync(filePath, `---\n${newFm}---\n${content}`, "utf-8");
		return;
	}

	const existingLines = fmMatch[1]!.split("\n");
	const existingKeys = new Set<string>();
	const updatedLines: string[] = [];

	for (const line of existingLines) {
		const colon = line.indexOf(":");
		if (colon <= 0) {
			updatedLines.push(line);
			continue;
		}
		const key = line.slice(0, colon).trim();
		existingKeys.add(key);
		if (key in updates) {
			updatedLines.push(formatFmLine(key, updates[key]!));
		} else {
			updatedLines.push(line);
		}
	}

	for (const [key, value] of Object.entries(updates)) {
		if (!existingKeys.has(key)) {
			updatedLines.push(formatFmLine(key, value));
		}
	}

	const newFm = updatedLines.join("\n");
	const body = content.slice(fmMatch[0]!.length);
	writeFileSync(filePath, `---\n${newFm}\n---${body}`, "utf-8");
}

function serializeFrontmatterBlock(updates: Record<string, unknown>): string {
	return (
		Object.entries(updates)
			.map(([k, v]) => formatFmLine(k, v))
			.join("\n") + "\n"
	);
}

function formatFmLine(key: string, value: unknown): string {
	if (value === null || value === undefined) return `${key}:`;
	if (typeof value === "number") return `${key}: ${value}`;
	if (typeof value === "boolean") return `${key}: ${value}`;
	if (Array.isArray(value)) {
		if (value.length === 0) return `${key}:`;
		const items = value.map((v) => `  - ${String(v)}`).join("\n");
		return `${key}:\n${items}`;
	}
	const s = String(value);
	if (/[:"#',{}[\]]/.test(s) || s.includes("\n")) {
		return `${key}: "${s.replace(/"/g, '\\"')}"`;
	}
	return `${key}: ${s}`;
}

// ─── 工具 ──────────────────────────────────────────────────────────

/**
 * 把 section 文本拆为列表项：
 * - `- foo` → `"foo"`
 * - `> bar` → `"bar"`（剥 `> ` 前缀，兼容 v5 引用块）
 * - 其他   → 保留 trim 后的原文
 * - 空行   → 丢弃
 */
function splitLines(text: string | undefined): string[] {
	if (!text) return [];
	return text
		.split("\n")
		.map((l) => l.replace(/^-\s+/, "").replace(/^>\s+/, "").trim())
		.filter(Boolean);
}
