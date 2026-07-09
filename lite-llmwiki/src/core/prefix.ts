import type { AppConfig, Source } from "../types.js";

// ─── 第一步：深度思考系统提示（给 Pro/Reasoning 模型） ──────────────
//
// 只给思考方法，不给格式约束。
// Reasoning 模型可以在推理链里自由拆解，不会和 JSON 格式冲突。

export const PRO_THINK_SYSTEM = `你是 lite-llmwiki 的"认知陪练引擎"。你的角色是冷静、洞察原材料结构、敢于提出反直觉视角的 sparring partner。

# 认知方法（自检清单）
1. 拆解拆分（还原论）：材料由哪些正交的基本单元构成？
2. 无损替换（同构映射）：论证结构可以用什么已知框架等价表达？
3. 有损近似：不确定的部分声明假设前提，标注 low confidence。

# 当前任务
根据 user message 中的 MODE 字段执行对应的分析任务。

## MODE: think-extract
深度阅读全部材料，输出你的分析。格式自由，但必须包含：

### 主线（2-3条）
每条主线：标题 + 一句话描述 + 涉及的 chunk 编号

### 知识点（2-4条/主线）
每个知识点：
- **claim**: raw 中提取的具体事实（引用原文依据）
- **aiReading**: 你基于该事实的解读（不是复述）
- **chunkRefs**: 涉及的 chunk 编号
- **kind**: 从 concept/claim/method/case/equation/question/insight/anchor/counter 中选择
- **evidence**: 原文中支撑 claim 的关键句（≤80字）+ chunk 编号
- **confidence**: 0-1 置信度
- **counterIntuitive**: 如果这个结论挑战了常见认知，标注 true 并说明挑战了什么

如果有 human anchor，按与 anchor 的相关度降序排列。

如果有 ## Existing Wiki Pages，判断每个知识点与已有页面的关系：
new（无重叠）/ overlap（高度重叠）/ extension（扩展已有）

### 假设（2-3个）
每个含：标题 + 相关节点 + 逻辑 + 可操作性

## MODE: think-compile
基于已确认的知识点，思考如何编译为 wiki 页面。格式自由，但必须包含：

### 新建页面
每个页面：
- nodeId（英文短横线）、kind、标题
- claim、evidence（引用 propRefs）、interpretation
- useFor、limits

### 更新页面（与已有页面有关系时）
哪个页面 + 追加什么内容

### 假设（2-3个）
每个含：标题 + 相关节点 + 逻辑 + 可操作性

# 通用规则
- 使用中文输出
- claim 必须来自 raw，aiReading 是你的解读
- 不要追求完美格式，重点是洞察深度
- 禁用开放式问题`;

// ─── 第二步：结构化提取系统提示（给 Flash/Chat 模型） ──────────────
//
// 只给格式约束，不给思考方法。
// 模型只需要做格式转换，不需要深度推理。

export const PRO_FORMAT_SYSTEM = `你是结构化数据提取引擎。你的唯一任务是把上一步的分析结果转换为严格的 JSON 格式。

# 输出格式
根据 user message 中的 MODE 字段选择输出格式。

## MODE: format-extract
{
  "mode": "extract",
  "title": "材料标题",
  "type": "md",
  "mainThreads": [
    { "id": 1, "title": "主线标题", "description": "一句话描述", "chunkRefs": [2, 3] }
  ],
  "propositions": [
    {
      "id": 1,
      "threadId": 1,
      "claim": "raw 中提取的具体事实",
      "aiReading": "AI 基于该事实的解读",
      "chunkRefs": [2, 3],
      "revision": 0,
      "counterIntuitive": true,
      "counterIntuitiveReason": "挑战了什么常见认知（仅 counterIntuitive=true 时）",
      "kind": "concept",
      "evidence": [
        { "sourceId": "材料ID", "chunkRefs": [2], "excerpt": "原文关键句（≤80字）" }
      ],
      "confidence": 0.9,
      "coverage": { "status": "new", "relatedPages": [] }
    }
  ],
  "hypotheses": [ ... ],
  "feedbackText": "..."
}

## MODE: format-compile
{
  "mode": "compile",
  "nodeDrafts": [
    {
      "nodeId": "slug-name",
      "kind": "concept",
      "filePath": "wiki/concepts/slug-name.md",
      "frontmatter": {
        "title": "标题",
        "confidence": 0.9,
        "tags": ["tag"],
        "related": []
      },
      "claim": "...",
      "evidence": [
        { "sourceId": "材料ID", "propRefs": ["1"], "summary": "摘要", "excerpt": "原文关键句" }
      ],
      "interpretation": "...",
      "useFor": ["用途"],
      "limits": ["限制"]
    }
  ],
  "updatedPages": [
    {
      "nodeId": "已有页面nodeId",
      "filePath": "wiki/concepts/existing.md",
      "updateType": "append",
      "body": "## [日期] 更新\\n补充内容..."
    }
  ],
  "hypotheses": [ ... ],
  "feedbackText": "..."
}

# 约束
- kind 只能从 concept/claim/method/case/equation/question/insight/anchor/counter 中选择
- evidence 至少 1 条，excerpt ≤80字
- confidence 0-1
- coverage 必填：new/overlap/extension
- 不要输出 devilsAdvocate 字段
- 只输出 JSON`;

// ─── 兼容：单步模式系统提示（reread 等简单模式） ────────────────────

export const PRO_SYSTEM = `你是 lite-llmwiki 的"认知陪练引擎"。你的角色是冷静、洞察原材料结构、敢于提出反直觉视角的 sparring partner。

# 输出模式
根据 user message 中的 MODE 字段选择输出格式。

## reread — MODE: reread
针对特定 chunk 按 human 新角度重新解读：
{
  "mode": "reread",
  "proposition": {
    "id": 1,
    "claim": "原 claim（保持不变）",
    "aiReading": "按新角度的修订解读",
    "chunkRefs": [2, 5],
    "threadId": 1,
    "revision": 1
  }
}

要求：
- claim 不变（事实不变）
- aiReading 基于 human 的新角度重新生成
- chunkRefs 可以扩展（新角度可能触及不同的 chunk）

# 通用规则
- 只输出 JSON
- 使用中文输出
- 禁用开放式问题`;

// ─── Workspace Rules ──────────────────────────────────────────────

export function buildWorkspaceRules(config: AppConfig): string {
	return `# Workspace Rules

## 目录结构
- raw/original/<md|pdf|tex>/  原始材料副本
- raw/chase/                  清洗后的 Markdown，中间证据层
- wiki/                       编译产物
  - concepts/
  - methods/
  - cases/
  - equations/

## wiki 文件 frontmatter
- nodeId / kind / title / sourceIds / sourceChase / propRefs / confidence / status / tags / related / createdAt / updatedAt

## 路径
- raw dir: ${config.rawDir}
- wiki dir: ${config.wikiDir}`;
}

// ─── Material Prefix ──────────────────────────────────────────────

export interface MaterialPrefixInput {
	source: Source;
	existingNodes?: Array<{ id: string; name: string; summary: string }>;
}

export function buildMaterialPrefix(input: MaterialPrefixInput): string {
	const source = input.source;
	let prefix = `# Material\n\n`;
	prefix += `ID: ${source.id}\n`;
	prefix += `Title: ${source.title}\n`;
	prefix += `Type: ${source.type}\n`;
	prefix += `Chunks: ${source.chunks.length}\n`;
	prefix += `Total tokens: ~${source.totalTokens}\n`;
	prefix += `File: ${source.path}\n`;

	if (input.existingNodes && input.existingNodes.length > 0) {
		prefix += `\n## Existing wiki nodes\n`;
		for (const node of input.existingNodes) {
			prefix += `- ${node.id}: ${node.summary}\n`;
		}
	}
	return prefix;
}

// ─── Variables ────────────────────────────────────────────────────

export interface VariablesInput {
	chunks: Array<{ text: string }>;
	anchor?: string;

	confirmedPropositionsJson?: string;

	// reread
	claim?: string;
	humanAngle?: string;
	targetChunkRefs?: number[];

	// compile: 已有 wiki 页面（用于 cross-page update）
	existingPages?: Array<{ filePath: string; title: string; summary: string }>;
}

export function buildVariables(input: VariablesInput): string {
	const isCompile = !!input.confirmedPropositionsJson;
	const isReread = !!input.humanAngle;
	const isExtract = !isCompile && !isReread;
	const mode = isCompile ? "compile" : isReread ? "reread" : "extract";

	let vars = `MODE: ${mode}\n\n`;

	if (input.anchor) vars += `## Human Anchor\n${input.anchor}\n\n`;

	if (isCompile && input.confirmedPropositionsJson) {
		vars += `## Confirmed Propositions\n${input.confirmedPropositionsJson}\n\n`;
	}

	if (
		(isCompile || isExtract) &&
		input.existingPages &&
		input.existingPages.length > 0
	) {
		vars += `## Existing Wiki Pages (可能需要更新)\n`;
		for (const p of input.existingPages) {
			vars += `- ${p.filePath}: "${p.title}" — ${p.summary.slice(0, 150)}\n`;
		}
		vars += "\n";
	}

	if (isReread) {
		vars += `## Re-read Context\n`;
		vars += `原 Claim: ${input.claim}\n`;
		vars += `Human 新角度: ${input.humanAngle}\n\n`;
		vars += `## Target Chunks（仅重新阅读这些 chunk）\n`;
		const targetSet = new Set(input.targetChunkRefs);
		for (let i = 0; i < input.chunks.length; i++) {
			if (targetSet.has(i + 1)) {
				vars += `### Chunk ${i + 1}\n${input.chunks[i]!.text}\n\n`;
			}
		}
		return vars;
	}

	// extract/compile: 全部 chunks
	vars += `## Source Content\n`;
	const SAFETY_TOKEN_CAP = 80_000;
	const EST_CHARS_PER_TOKEN = 4;
	let totalChars = 0;
	const cap = SAFETY_TOKEN_CAP * EST_CHARS_PER_TOKEN;

	for (let i = 0; i < input.chunks.length; i++) {
		const chunkText = input.chunks[i]!.text;
		const chunkLen = chunkText.length;
		if (totalChars + chunkLen > cap) {
			vars += `### Chunk ${i + 1} (truncated)\n${chunkText.slice(0, cap - totalChars)}...\n\n`;
			vars += `[WARNING: ${input.chunks.length - i - 1} remaining chunks omitted]\n\n`;
			break;
		}
		vars += `### Chunk ${i + 1}\n${chunkText}\n\n`;
		totalChars += chunkLen;
	}
	return vars;
}

// ─── 前缀组装器 ───────────────────────────────────────────────────

export interface BuildPrefixOptions {
	config: AppConfig;
	source: Source;
	anchor?: string;
	existingNodes?: Array<{ id: string; name: string; summary: string }>;

	// compile
	confirmedPropositionsJson?: string;
	// reread
	claim?: string;
	humanAngle?: string;
	targetChunkRefs?: number[];

	// compile: 已有 wiki 页面
	existingPages?: Array<{ filePath: string; title: string; summary: string }>;
}

/** 单步模式（reread）的 prompt 组装 */
export function buildIngestPrefix(opts: BuildPrefixOptions): {
	systemPrompt: string;
	userMessage: string;
} {
	const systemPrompt = [
		PRO_SYSTEM,
		"",
		buildWorkspaceRules(opts.config),
		"",
		buildMaterialPrefix({
			source: opts.source,
			existingNodes: opts.existingNodes,
		}),
	].join("\n");

	const userMessage = buildVariables({
		chunks: opts.source.chunks,
		anchor: opts.anchor,
		confirmedPropositionsJson: opts.confirmedPropositionsJson,
		claim: opts.claim,
		humanAngle: opts.humanAngle,
		targetChunkRefs: opts.targetChunkRefs,
		existingPages: opts.existingPages,
	});

	return { systemPrompt, userMessage };
}

// ─── 两步模式的 prompt 组装 ──────────────────────────────────────────

/** 深度思考材料前缀（extract/compile 共用） */
function buildThinkContext(opts: BuildPrefixOptions): string {
	const parts: string[] = [];

	parts.push(
		buildMaterialPrefix({
			source: opts.source,
			existingNodes: opts.existingNodes,
		}),
	);

	if (opts.anchor) parts.push(`\n## Human Anchor\n${opts.anchor}\n`);

	if (opts.existingPages && opts.existingPages.length > 0) {
		parts.push(`\n## Existing Wiki Pages (可能需要更新)\n`);
		for (const p of opts.existingPages) {
			parts.push(
				`- ${p.filePath}: "${p.title}" — ${p.summary.slice(0, 150)}\n`,
			);
		}
	}

	return parts.join("\n");
}

/** 第一步：深度思考（给 Pro 模型） */
export function buildThinkStepPrefix(
	opts: BuildPrefixOptions,
	thinkMode: "think-extract" | "think-compile",
): {
	systemPrompt: string;
	userMessage: string;
} {
	const systemPrompt = PRO_THINK_SYSTEM;

	let userMessage = `MODE: ${thinkMode}\n\n`;

	if (thinkMode === "think-extract") {
		// 发送全部 chunks
		userMessage += buildThinkContext(opts);
		userMessage += buildSourceChunks(opts.source.chunks);
	} else {
		// compile: 发送已确认的 propositions
		userMessage += buildThinkContext(opts);
		if (opts.confirmedPropositionsJson) {
			userMessage += `\n## Confirmed Propositions\n${opts.confirmedPropositionsJson}\n`;
		}
	}

	return { systemPrompt, userMessage };
}

/** 第二步：结构化提取（给 Flash 模型） */
export function buildFormatStepPrefix(
	opts: BuildPrefixOptions,
	formatMode: "format-extract" | "format-compile",
	thinkResult: string,
): {
	systemPrompt: string;
	userMessage: string;
} {
	const systemPrompt = PRO_FORMAT_SYSTEM;

	const userMessage = `MODE: ${formatMode}

## 材料信息
- 材料ID: ${opts.source.id}
- 标题: ${opts.source.title}
- 类型: ${opts.source.type}

## 上一步深度分析结果
${thinkResult}`;

	return { systemPrompt, userMessage };
}

/** 构建 chunks 文本 */
function buildSourceChunks(chunks: Array<{ text: string }>): string {
	let vars = `\n## Source Content\n`;
	const SAFETY_TOKEN_CAP = 80_000;
	const EST_CHARS_PER_TOKEN = 4;
	let totalChars = 0;
	const cap = SAFETY_TOKEN_CAP * EST_CHARS_PER_TOKEN;

	for (let i = 0; i < chunks.length; i++) {
		const chunkText = chunks[i]!.text;
		const chunkLen = chunkText.length;
		if (totalChars + chunkLen > cap) {
			vars += `### Chunk ${i + 1} (truncated)\n${chunkText.slice(0, cap - totalChars)}...\n\n`;
			vars += `[WARNING: ${chunks.length - i - 1} remaining chunks omitted]\n\n`;
			break;
		}
		vars += `### Chunk ${i + 1}\n${chunkText}\n\n`;
		totalChars += chunkLen;
	}
	return vars;
}
