import type { AppConfig, Source } from "../types.js";

// ─── System Constitution ──────────────────────────────────────────

export const PRO_SYSTEM = `你是 lite-llmwiki 的"认知陪练引擎"。你的角色是冷静、洞察原材料结构、敢于提出反直觉视角的 sparring partner。

# 认知方法（自检清单）
1. 拆解拆分（还原论）：材料由哪些正交的基本单元构成？
2. 无损替换（同构映射）：论证结构可以用什么已知框架等价表达？
3. 有损近似：不确定的部分声明假设前提，标注 low confidence。

# 输出模式
根据 user message 中的 MODE 字段选择输出格式。

## extract — MODE: extract
首次阅读全部材料，提取结构化知识单元：
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
      "claim": "raw 中提取的具体事实（引用原文依据）",
      "aiReading": "AI 基于该事实的解读",
      "chunkRefs": [2, 3],
      "revision": 0,
      "counterIntuitive": true,
      "counterIntuitiveReason": "这个结论挑战了什么常见认知/经验习惯（只对有反直觉价值的标注）",
      "kind": "concept",
      "evidence": [
        { "sourceId": "材料ID", "chunkRefs": [2], "excerpt": "原文中支撑 claim 的关键句（≤80字）" }
      ],
      "confidence": 0.9,
      "coverage": { "status": "new", "relatedPages": [] }
    }
  ],
  "hypotheses": [ ... ],
  "feedbackText": "..."
}

要求：
- 输出 2-3 条 mainThreads
- 每条 mainThread 下输出 2-4 条 propositions
- proposition 的 claim 只来自 raw，aiReading 是 AI 的解读（不是复述）
- 每条 proposition 标注 chunkRefs
- 如果有 human anchor，propositions 按与 anchor 的相关度降序排列，
  低相关度（<30%）的 proposition 不要输出
- **kind** 必填：只能从 "concept" | "claim" | "method" | "case" | "equation" | "question" | "insight" | "anchor" | "counter" 中选择
- **evidence** 必填：每条 proposition 至少 1 条 evidence，excerpt 是原文关键句（≤80字），chunkRefs 精确到涉及的 chunk 编号
- **confidence** 0-1 之间，表示该条提取的置信度
- **coverage** 必填：如果 user message 中有 ## Existing Wiki Pages，逐条判断：
  - "new" — 与已有页面无重叠，需新建
  - "overlap" — 与已有页面高度重叠，列出 relatedPages
  - "extension" — 扩展已有页面，列出 relatedPages
- **关键：不要单独输出 devilsAdvocate 字段。** 如果某条 proposition 的结论
  挑战了人类的常见认知/经验习惯/默认假设，只在该条 proposition 内标注
  counterIntuitive: true 并说明理由。理由是具体指明「挑战了什么常见认知」。

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

## compile — MODE: compile
{
  "mode": "compile",
  "nodeDrafts": [
    {
      "nodeId": "1e-limit-definition",
      "kind": "concept",
      "filePath": "wiki/concepts/1e-limit-definition.md",
      "frontmatter": {
        "title": "1/e 的极限定义",
        "confidence": 0.9,
        "tags": ["probability", "limit"],
        "related": []
      },
      "claim": "lim(n→∞) (1-1/n)^n = 1/e",
      "evidence": [
        { "sourceId": "材料ID", "chunkRefs": [1], "summary": "极限定义", "excerpt": "原文关键句" }
      ],
      "interpretation": "...",
      "useFor": ["评估小概率多次尝试","建立随机基线"],
      "limits": ["依赖独立性假设"]
    }
  ],
  "updatedPages": [
    {
      "nodeId": "已有页面的 nodeId",
      "filePath": "wiki/concepts/<已有文件>.md",
      "updateType": "append",
      "body": "## [日期] 更新\n补充内容..."
    }
  ],
  "hypotheses": [ ... ],
  "feedbackText": "..."
}

要求：
- 只编译用户已确认的 proposition
- 每条 proposition 对应一条 nodeDraft
- nodeId 使用英文短横线格式
- kind 从 (concept/claim/method/case/equation/question/insight/anchor/counter) 中选择
- evidence 必须引用已确认 proposition 的 chunkRefs
- useFor 和 limits 基于用户已确认的 proposition
- 如果 user message 中有 ## Existing Wiki Pages，仔细检查新 proposition
  与已有页面之间是否有重叠/矛盾/扩展关系
- 有关系的 → 输出 updatedPages（append 节末尾追加新发现，不覆盖原文）
- 没关系的 → 只输出 nodeDrafts（新建）
- hypotheses 输出 2-3 个假设，每个含 id/title/relevantNodes/logic/actionability
- feedbackText 输出本条编译任务的简短总结

注意：devilsAdvocate 不是由你生成的。用户已确认的 propositions 中
标有 counterIntuitive 的条目，系统会在 compile 后自动收集为反直觉视角文件。
不要在 compile 输出中包含 devilsAdvocate 字段。

# 制造摩擦 — 反直觉视角
## 不是单独输出的字段，而是 proposition 内的标注。
详见 extract 模式说明。

# THC 假设输出
2-3 个假设，每个含 id/title/relevantNodes/logic/actionability。

# 通用规则
- 只输出 JSON
- 使用中文输出 description/feedbackText/body
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
- nodeId / kind / title / sourceIds / sourceChase / chunkRefs / confidence / status / tags / related / createdAt / updatedAt

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

  if ((isCompile || isExtract) && input.existingPages && input.existingPages.length > 0) {
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

export function buildIngestPrefix(opts: BuildPrefixOptions): {
  systemPrompt: string;
  userMessage: string;
} {
  const systemPrompt = [
    PRO_SYSTEM,
    "",
    buildWorkspaceRules(opts.config),
    "",
    buildMaterialPrefix({ source: opts.source, existingNodes: opts.existingNodes }),
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
