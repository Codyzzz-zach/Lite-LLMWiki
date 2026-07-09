/**
 * proposition — 命题提取
 *
 * 将 chase 纯文本（带 chunk marker）调用 LLM 拆分为原子命题，
 * 在 chase 文件中插入 `<!-- prop N -->` marker。
 *
 * 命题提取是 daemon 职责①——在 daemon 建成前，由 CLI extract-props 命令
 * 或 ingest 管线内联调用。
 *
 * 设计决策（架构设计 §04）：
 * - 命题级 chunk 是审计的前提（EMNLP 2024 实验证据支持）
 * - 一次 LLM 调用，结果持久化，compile 和 audit 复用
 * - loader 层保持纯机械，命题提取由 daemon/CLI 触发
 */

import type { ChaseProp } from "../types.js";

// ─── 类型 ──────────────────────────────────────────────────────────

export interface PropositionExtractResult {
	/** 提取到的命题列表 */
	props: ChaseProp[];
	/** 插入 prop marker 后的完整 chase 内容 */
	updatedContent: string;
}

/** LLM 返回的原始命题条目 */
interface RawProposition {
	/** 1-based 序号 */
	index: number;
	/** 命题文本——必须是原文中的完整句子或自包含的原子事实 */
	text: string;
	/** 该命题来自哪个 chunk（对应 chunk marker 编号） */
	chunkIndex: number;
}

// ─── Prompt ────────────────────────────────────────────────────────

const PROPOSITION_SYSTEM = `你是一个精密的知识提取器。你的任务是阅读一篇文档，将其拆分为原子命题。

# 什么是原子命题
- 一个自包含的、可以独立验证真伪的事实陈述
- 不能进一步拆分而不丢失信息
- 必须来自原文——不能添加原文没有的主张
- 每个命题应该是 1-3 个完整的句子
- 输出格式：{"propositions": [{"index":1,"text":"命题原文","chunkIndex":1}]}

# 拆分原则
1. 复合句拆成多个命题（每个"因为"、"但是"、"然而"、"并且"前后各是一个命题）
2. 列举拆成多个命题（每个列举项是一个命题）
3. 保持原文措辞——不要改写、摘要、或综合
4. 每个命题标注它来自哪个 chunk（对应原文中的 <!-- chunk N --> 标记）

# 输出格式
返回 JSON 对象，propositions 字段包含数组：
{
  "propositions": [
    { "index": 1, "text": "量子纠缠是指两个粒子无论相距多远，其量子态都保持关联。", "chunkIndex": 1 },
    { "index": 2, "text": "这种关联无法用于超光速通信。", "chunkIndex": 1 }
  ]
}

# 关键约束
- text 必须是原文逐句——不是摘要、不是改写
- 不能跳过任何有信息量的句子
- 忽略纯格式标记（标题、分隔线等），但保留标题中的关键术语
- 如果原文是代码/公式，将其作为一个命题保留`;

function buildPropositionPrompt(chaseContent: string): string {
	return `请将以下文档拆分为原子命题。输出 JSON 对象，propositions 字段包含命题数组。不要包含 markdown 代码块标记。

---
${chaseContent}
---`;
}

// ─── 解析与插入 ────────────────────────────────────────────────────

/** 从 LLM 响应中解析命题数组 */
function parsePropositionResponse(response: string): RawProposition[] {
	// 清理可能的 markdown 代码块
	let cleaned = response.trim();
	if (cleaned.startsWith("```")) {
		const end = cleaned.indexOf("\n", 3);
		cleaned = cleaned.slice(end + 1);
		if (cleaned.endsWith("```")) {
			cleaned = cleaned.slice(0, -3);
		}
		cleaned = cleaned.trim();
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(cleaned);
	} catch {
		throw new Error(
			`Failed to parse proposition LLM response as JSON: ${cleaned.slice(0, 200)}`,
		);
	}

	// 支持两种格式：旧数组 或 {propositions: [...]}（json_object 模式要求对象顶层）
	let arr: unknown[];
	if (Array.isArray(parsed)) {
		arr = parsed;
	} else if (
		typeof parsed === "object" &&
		parsed !== null &&
		Array.isArray((parsed as Record<string, unknown>).propositions)
	) {
		arr = (parsed as Record<string, unknown>).propositions as unknown[];
	} else {
		throw new Error(
			`Proposition response is not an array or {propositions:[...]}: ${typeof parsed}`,
		);
	}

	const props: RawProposition[] = [];
	let idx = 0;
	for (const item of arr) {
		idx++;
		// 格式1: {index, text, chunkIndex}
		if (
			typeof item === "object" &&
			item !== null &&
			typeof (item as Record<string, unknown>).text === "string"
		) {
			props.push({
				index: ((item as Record<string, unknown>).index as number) ?? idx,
				text: (item as Record<string, unknown>).text as string,
				chunkIndex:
					((item as Record<string, unknown>).chunkIndex as number) ?? 1,
			});
		}
		// 格式2: 纯字符串
		else if (typeof item === "string" && item.trim().length > 0) {
			props.push({ index: idx, text: item.trim(), chunkIndex: 1 });
		}
	}

	if (props.length === 0) {
		throw new Error("No valid propositions found in LLM response");
	}

	// 按 index 排序
	props.sort((a, b) => a.index - b.index);
	return props;
}

/**
 * 在 chase 内容中插入 `<!-- prop N -->` marker。
 *
 * 策略：在每个命题文本首次出现的位置前插入 marker。
 * 由于命题是原文逐句，可以通过字符串匹配定位。
 * 如果命题文本在原文中出现多次，只在第一次出现处插入。
 */
function insertPropMarkers(content: string, props: RawProposition[]): string {
	// 按 chunkIndex 分组，在每段 chunk 开头批量插入该 chunk 的所有 prop marker
	const byChunk = new Map<number, RawProposition[]>();
	for (const p of props) {
		const list = byChunk.get(p.chunkIndex) || [];
		list.push(p);
		byChunk.set(p.chunkIndex, list);
	}

	const chunks = parseChunkBoundaries(content);
	if (chunks.length === 0) {
		// 无 chunk marker——在文件顶部插入全部 prop
		const markers = props.map((_p, i) => `<!-- prop ${i + 1} -->`).join("\n");
		return markers + "\n\n" + content;
	}

	let result = content;
	let offset = 0;
	let propCounter = 1;

	// 按 chunk 顺序处理：在每个 chunk 的 <!-- /chunk:N --> 结束标记后插入 prop 列表
	for (const boundary of chunks) {
		const chunkProps = byChunk.get(boundary.index) || [];
		if (chunkProps.length === 0) continue;

		// 找到该 chunk 结束标记的位置（<!-- /chunk:N -->）
		const endMarker = `<!-- /chunk:${boundary.index} -->`;
		let endPos = result.indexOf(endMarker, boundary.startPos);
		// v6 格式无结束标记——插在下一个 chunk 之前或 EOF
		if (endPos === -1) {
			const nextIdx = chunks.indexOf(boundary) + 1;
			endPos =
				nextIdx < chunks.length ? chunks[nextIdx]!.startPos - 1 : result.length;
		}

		const insertPos =
			endPos === -1
				? result.length
				: endPos +
					(result.indexOf(endMarker, boundary.startPos) !== -1
						? endMarker.length
						: 0);
		const propMarkers = chunkProps
			.map(() => {
				const m = `<!-- prop ${propCounter} -->`;
				propCounter++;
				return m;
			})
			.join("\n");

		result =
			result.slice(0, insertPos + offset) +
			"\n" +
			propMarkers +
			"\n" +
			result.slice(insertPos + offset);
		offset += propMarkers.length + 2;
	}

	return result;
}

interface ChunkBoundary {
	index: number;
	startPos: number;
	endPos: number;
}

/** 解析 chase 内容中的 chunk 边界 */
function parseChunkBoundaries(content: string): ChunkBoundary[] {
	const re = /<!--\s*chunk[\s:](\d+)(?:\s+[^>]*)?\s*-->/gi;
	const boundaries: ChunkBoundary[] = [];
	const matches: Array<{ index: number; pos: number; marker: string }> = [];

	for (const m of content.matchAll(re)) {
		matches.push({
			index: Number(m[1]),
			pos: m.index ?? 0,
			marker: m[0],
		});
	}

	for (let i = 0; i < matches.length; i++) {
		const cur = matches[i]!;
		const startPos = cur.pos + cur.marker.length;
		const endPos =
			i < matches.length - 1 ? matches[i + 1]!.pos : content.length;
		boundaries.push({ index: cur.index, startPos, endPos });
	}

	return boundaries;
}

// ─── 主入口 ────────────────────────────────────────────────────────

/**
 * 从 chase 纯文本中提取命题，并插入 prop marker。
 *
 * @param chaseContent - chase 文件内容（含 chunk marker）
 * @param llmCaller - LLM 调用函数，接收 prompt 返回响应文本
 * @returns 提取结果——命题列表 + 带 prop marker 的更新内容
 */
export async function extractPropositions(
	chaseContent: string,
	llmCaller: (prompt: string) => Promise<string>,
): Promise<PropositionExtractResult> {
	const prompt = buildPropositionPrompt(chaseContent);
	const response = await llmCaller(prompt);
	const rawProps = parsePropositionResponse(response);
	const updatedContent = insertPropMarkers(chaseContent, rawProps);

	const props: ChaseProp[] = rawProps.map((p) => ({
		index: p.index,
		text: p.text,
		marker: `<!-- prop ${p.index} -->`,
	}));

	return { props, updatedContent };
}
