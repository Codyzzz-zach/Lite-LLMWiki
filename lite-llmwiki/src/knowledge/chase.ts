/**
 * chase — 清洗层 (raw/chase/) 读取与解析工具
 *
 * chase 是 v6 的审查基准层：
 * - 每次 ingest 都写入 chase
 * - chase 文件包含稳定 chunk marker
 * - wiki node 的 sourceChase 指向 chase
 * - chunkRefs 可在 chase 中定位
 *
 * Marker 格式同时兼容 v5（`<!-- chunk:N -->`）与 v6（`<!-- chunk N -->`）：
 * - v5: 冒号分隔，可带注释后缀（`<!-- chunk:1 foo -->`）
 * - v6: 空格分隔，无后缀
 * 解析时按数字 index 去重（保留首次出现位置）。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig, ChaseChunk, ChaseProp } from "../types.js";

/** 兼容 v5 + v6 的 chunk marker 单一正则。 */
const CHASE_MARKER = /<!--\s*chunk[\s:](\d+)(?:\s+[^>]*)?\s*-->/gi;
/** prop marker —— 命题级分块。格式：<!-- prop N --> */
const PROP_MARKER = /<!--\s*prop\s+(\d+)\s*-->/gi;

/**
 * 按 sourceChase 路径列表找到第一个可读的 chase 文件。
 *
 * 接受多种路径形式（统一取 basename 然后 join with rawDir/chase）：
 * - 绝对路径 `/abs/path/foo.md` → 直接用
 * - 相对 `raw/chase/foo.md`     → basename = "foo.md"
 * - 仅 basename `foo.md`         → basename = "foo.md"
 *
 * 这样无论 `sourceChase` 是 `["raw/chase/x.md"]` 还是 `["x.md"]` 都能定位到
 * `<rawDir>/chase/x.md`。
 */
export function resolveChasePath(
	config: AppConfig,
	sourceChase: string[],
): string | null {
	if (!sourceChase || sourceChase.length === 0) return null;
	for (const relPath of sourceChase) {
		if (relPath.startsWith("/")) {
			if (existsSync(relPath)) return relPath;
		} else {
			const basename = relPath.split("/").pop() ?? relPath;
			const fullPath = join(config.rawDir, "chase", basename);
			if (existsSync(fullPath)) return fullPath;
		}
	}
	return null;
}

/**
 * 读取 chase 文件并按 chunk 分割。
 *
 * 抛出错误（chase 缺失必须可见，spec 7.7）：
 * - 文件不存在 → 抛 `ChaseNotFoundError`
 * - 文件不可读 → 抛原始 IO 错误
 */
export function readChaseChunks(
	config: AppConfig,
	sourceChase: string[],
): ChaseChunk[] {
	const path = resolveChasePath(config, sourceChase);
	if (!path) {
		throw new ChaseNotFoundError(
			`chase file not found for sourceChase: ${sourceChase.join(", ")}`,
		);
	}
	const content = readFileSync(path, "utf-8");
	return parseChaseChunks(content);
}

export class ChaseNotFoundError extends Error {
	override name = "ChaseNotFoundError";
}

/**
 * 读取 chase 文件并按命题（prop marker）分割。
 *
 * 与 readChaseChunks 类似，但解析 `<!-- prop N -->` marker 而非 chunk marker。
 * 如果 chase 文件还没有 prop marker，返回空数组（命题提取尚未执行）。
 */
export function readChaseProps(
	config: AppConfig,
	sourceChase: string[],
): ChaseProp[] {
	const path = resolveChasePath(config, sourceChase);
	if (!path) return [];
	const content = readFileSync(path, "utf-8");
	return parseChaseProps(content);
}

/** selectChaseChunks 的返回结果：命中的 chunk 与请求中未命中的 index */
export interface SelectChaseChunksResult {
	found: ChaseChunk[];
	missing: number[];
}

/** 按 chunkRefs 筛选特定的 chase chunk；返回命中与未命中的 refs */
export function selectChaseChunks(
	config: AppConfig,
	sourceChase: string[],
	chunkRefs: number[],
): SelectChaseChunksResult {
	const all = readChaseChunks(config, sourceChase);
	const found: ChaseChunk[] = [];
	const missing: number[] = [];
	for (const ref of chunkRefs) {
		const chunk = all.find((c) => c.index === ref);
		if (chunk) found.push(chunk);
		else missing.push(ref);
	}
	return { found, missing };
}

/** 从 chase 文件中提取命中的 chunk text（适合 semantic audit 的 excerpt） */
export function getExcerpt(
	config: AppConfig,
	sourceChase: string[],
	chunkRefs: number[],
): { index: number; text: string }[] {
	return selectChaseChunks(config, sourceChase, chunkRefs).found.map((c) => ({
		index: c.index,
		text: c.text,
	}));
}

/** 收集 chase 文件中的所有 chunk 索引 */
export function collectChunkIndices(content: string): Set<number> {
	const indices = new Set<number>();
	const re = new RegExp(CHASE_MARKER.source, CHASE_MARKER.flags);
	for (const m of content.matchAll(re)) {
		indices.add(Number(m[1]));
	}
	return indices;
}

/** 收集 chase 文件中的所有 prop 索引 */
export function collectPropIndices(content: string): Set<number> {
	const indices = new Set<number>();
	const re = new RegExp(PROP_MARKER.source, PROP_MARKER.flags);
	for (const m of content.matchAll(re)) {
		indices.add(Number(m[1]));
	}
	// 无 prop marker 时回退到 chunk 索引（兼容旧 chase 格式）
	if (indices.size === 0) {
		return collectChunkIndices(content);
	}
	return indices;
}

// ─── 内部 ──────────────────────────────────────────────────────────

function parseChaseChunks(content: string): ChaseChunk[] {
	const chunks: ChaseChunk[] = [];
	const re = new RegExp(CHASE_MARKER.source, CHASE_MARKER.flags);
	const matches: Array<{ index: number; pos: number; marker: string }> = [];

	for (const m of content.matchAll(re)) {
		matches.push({
			index: Number(m[1]),
			pos: m.index ?? 0,
			marker: m[0],
		});
	}

	if (matches.length === 0) {
		// 无 marker — 整文件视为单 chunk 0
		return [{ index: 0, text: content.trim(), marker: "" }];
	}

	for (let i = 0; i < matches.length; i++) {
		const cur = matches[i]!;
		const start = cur.pos + cur.marker.length;
		const end = i < matches.length - 1 ? matches[i + 1]!.pos : content.length;
		const text = content.slice(start, end).trim();
		chunks.push({ index: cur.index, text, marker: cur.marker });
	}

	return chunks;
}

function parseChaseProps(content: string): ChaseProp[] {
	const props: ChaseProp[] = [];
	const re = new RegExp(PROP_MARKER.source, PROP_MARKER.flags);
	const matches: Array<{ index: number; pos: number; marker: string }> = [];

	for (const m of content.matchAll(re)) {
		matches.push({
			index: Number(m[1]),
			pos: m.index ?? 0,
			marker: m[0],
		});
	}

	if (matches.length === 0) return [];

	for (let i = 0; i < matches.length; i++) {
		const cur = matches[i]!;
		const start = cur.pos + cur.marker.length;
		const end = i < matches.length - 1 ? matches[i + 1]!.pos : content.length;
		const text = content.slice(start, end).trim();
		props.push({ index: cur.index, text, marker: cur.marker });
	}

	return props;
}
