# lite-llmwiki v5.0 设计方案

*目标：从“材料总结器”升级为“Agent 可调用的第二大脑编译器”*

---

## 0. 一句话愿景

让 Claude Code、opencode、Codex 等 agent 能够稳定调用 `llmwiki` CLI，把任意 raw 材料编译成可追溯、可查询、可复用、可启发的 wiki 节点，并在后续任务中把这些节点当作自己的第二大脑使用。

v5.0 的核心转变：

```
v4.x: raw -> LLM 总结 -> wiki markdown
v5.0: raw -> chase evidence -> verified knowledge nodes -> agent-readable wiki -> query/inspire contract
```

---

## 1. 当前问题诊断

以 `e 的基本画像` 为样本，当前 wiki 能抓到几个高价值概念，但尚未达到第二大脑目标。

### 1.1 证据链不足

当前页面只写：

```yaml
source: e 的基本画像
confidence: 0.9
```

问题：
- 不知道来自哪个 `raw/chase` 文件
- 不知道对应哪些 chunk
- 不知道哪些句子是原文事实，哪些是 AI 解读
- agent 回答时无法可靠引用证据

优化：
- 所有 wiki 页必须有 `sourceId / sourceChase / chunkRefs / evidence`
- 每个 claim 至少绑定一个 chunk
- evidence 中保存短摘录或证据摘要

### 1.2 覆盖率不足

当前 `e 的基本画像` 原文是系统说明书，但 wiki 只产出 3 个概念页 + 反直觉页 + anchor 空壳。

问题：
- 适合 inspire，不适合作为完整记忆
- 原文大量使用场景没有进入 wiki
- agent 查询具体应用时容易漏答

优化：
- 增加 `coveragePlan`
- brainstorm 先输出材料覆盖图，再输出 propositions
- compile 后生成 coverage report，标注已覆盖/未覆盖章节

### 1.3 页面粒度偏“总结文章”

当前页面像短文：

```md
# 1/e 与最优停止和贪心算法
...
```

问题：
- 一个页面混合多个知识对象
- agent 很难判断“这是概念、方法、案例、还是洞察”
- 后续增量更新难以合并

优化：
- wiki 页改为固定知识节点格式
- 每页必须有 `kind`
- 页面按原子知识单位切分

### 1.4 CLI 不够 agent-friendly

当前 ingest 偏 human-in-loop：

```text
主线选择 -> a/s/m -> compile -> 确认更新
```

问题：
- agent 自动调用时会卡在交互输入
- 没有稳定 JSON 输出
- 没有 dry-run / plan / audit 模式
- 失败恢复能力弱

优化：
- 增加非交互命令契约
- 所有关键命令支持 `--json`
- 增加 `--auto`, `--dry-run`, `--resume`, `--policy`

### 1.5 Query 层偏弱

当前 query 是关键词搜 wiki 文件，然后让模型回答。

问题：
- 没有 evidence-aware retrieval
- 没有 inspire 专门模式
- 没有返回机器可用的 source list
- agent 不能稳定消费结果

优化：
- search/query/inspire 分离
- search 返回结构化节点和 evidence
- query 用 evidence 回答
- inspire 用 graph/related/counterIntuitive 生成启发

---

## 2. v5.0 固定目录结构

v5.0 使用两层 raw：

```text
raw/
  original/
    md/
    pdf/
    tex/
      <tex-project-folder>/
  chase/
    raw_<type>_<name>-<fingerprint>.md
```

语义：

- `raw/original`: 原始材料，不是 LLM 直接消费层
- `raw/chase`: 清洗后的 Markdown，是 LLM 真实输入层

TeX 特殊规则：

```text
source.path     = raw/original/tex/<project>/main.tex
source.sourceRoot = raw/original/tex/<project>
```

TeX 的原始单位是项目文件夹，不是单个 `.tex` 文件。

---

## 3. v5.0 Wiki 节点格式

所有 wiki 页面改成 agent-readable schema。

### 3.1 Frontmatter

```yaml
---
nodeId: concept/one-over-e-probability-limit
kind: concept
title: 1/e 的概率极限角色
sourceIds:
  - raw_pdf_e 的基本画像-101349df399af024
sourceChase:
  - raw/chase/raw_pdf_e 的基本画像-101349df399af024.md
chunkRefs:
  - 1
  - 2
confidence: 0.86
status: verified
createdAt: 2026-06-01T00:00:00.000Z
updatedAt: 2026-06-01T00:00:00.000Z
tags:
  - probability
  - exponential
  - one-over-e
related:
  - concept/exponential-time-constant
---
```

### 3.2 Body

```md
# 1/e 的概率极限角色

## Claim
1/e 经常作为“许多微小机会都失败”的极限概率出现。

## Evidence
- chunk 1: 错位排列中，没有任何人拿对帽子的概率随 n 增大趋近 1/e。
- chunk 1: n 次独立试验、每次成功概率 1/n，则全都不成功的概率趋近 1/e。

## Interpretation
这说明“机会很多”并不自动意味着失败概率趋近于 0；在小概率机会叠加的结构里，失败概率会稳定在约 36.8%。

## Use For
- 评估小概率多次尝试的一无所获概率
- 给随机失败/完全错位现象建立基线直觉
- 作为 agent 在风险判断中的先验提醒

## Limits
- 依赖独立性、低概率、次数与概率耦合等前提
- 不能直接套用于任意重复尝试

## Links
- [[1/e 作为指数衰减的特征时间]]
```

### 3.3 kind 分类

```text
concept      稳定概念
claim        原文具体主张
method       可执行方法/流程
case         案例/应用场景
equation     公式/数学结构
question     值得追问的问题
insight      AI/人类确认后的洞察
anchor       用户个人锚点
counter      反直觉/反方视角
```

---

## 4. Raw -> Wiki 新流水线

### 4.1 Stage A: Load

输入：

```text
md/pdf/tex project
```

输出：

```typescript
Source {
  id,
  path,
  sourceRoot?,
  type,
  title,
  body,
  chunks,
  fingerprint,
}
```

优化点：
- PDF/TeX 清洗后必须写入 `raw/chase`
- chunks 的边界要可复现
- `raw/chase` frontmatter 记录 `sourcePath/sourceRoot/sourceType/fingerprint`

### 4.2 Stage B: Brainstorm 变成 Extract

v4 的 brainstorm 直接输出 propositions。v5 改为同时输出 coverage。

```json
{
  "mode": "extract",
  "coveragePlan": [
    {
      "section": "概率论与统计",
      "chunkRefs": [1, 2],
      "importance": "high",
      "status": "covered"
    }
  ],
  "propositions": [
    {
      "id": 1,
      "kind": "concept",
      "claim": "...",
      "evidence": [
        { "chunkRef": 1, "quote": "...", "summary": "..." }
      ],
      "aiReading": "...",
      "confidence": "high",
      "counterIntuitive": true
    }
  ]
}
```

具体做法：
- `Proposition` 增加 `kind/evidence/confidence/sourceId`
- prompt 明确禁止无 evidence 的 proposition
- 对每个 chunk 至少给出 covered/skipped 原因

### 4.3 Stage C: Confirm

仍保留 human-in-loop，但新增 agent 模式。

Human 模式：

```text
a / s / m / a all
```

Agent 模式：

```bash
llmwiki ingest <path> --auto --policy conservative --json
```

策略：

| policy | 行为 |
|---|---|
| conservative | 只确认 high confidence + evidence 完整 |
| balanced | high/medium 都可确认 |
| expansive | 保留更多 insight/question 节点 |

### 4.4 Stage D: Compile

compile 不再输出自由散文页面，而输出 `WikiNodeDraft[]`。

```typescript
WikiNodeDraft {
  nodeId: string;
  kind: WikiKind;
  filePath: string;
  frontmatter: WikiFrontmatter;
  sections: {
    claim?: string;
    evidence: Evidence[];
    interpretation?: string;
    useFor?: string[];
    limits?: string[];
    links?: string[];
  };
}
```

保存时由本地 deterministic renderer 渲染 Markdown，减少 LLM 格式漂移。

---

## 5. Agent CLI 契约

### 5.1 ingest

```bash
llmwiki ingest <path> \
  --auto \
  --policy conservative \
  --json
```

输出：

```json
{
  "ok": true,
  "sourceId": "raw/pdf/...",
  "sourceChase": "raw/chase/...",
  "created": ["wiki/concepts/...md"],
  "updated": [],
  "skipped": [],
  "coverage": {
    "coveredChunks": 4,
    "totalChunks": 4,
    "uncoveredReasons": []
  }
}
```

### 5.2 plan

只抽取，不落 wiki：

```bash
llmwiki plan <path> --json
```

用途：
- agent 先看会生成什么
- human 可以审查 coverage/propositions

### 5.3 audit

检查 wiki 是否能追溯到 raw/chase：

```bash
llmwiki audit --source raw_pdf_e... --json
```

检查项：
- sourceChase 是否存在
- chunkRefs 是否有效
- evidence 是否非空
- wiki claim 是否缺失证据
- coverage 是否过低

### 5.4 search

结构化检索，不调用 LLM：

```bash
llmwiki search "1/e 失败概率" --json
```

返回：

```json
{
  "matches": [
    {
      "nodeId": "concept/one-over-e-probability-limit",
      "title": "1/e 的概率极限角色",
      "kind": "concept",
      "score": 0.82,
      "evidence": [...]
    }
  ]
}
```

### 5.5 query

基于 wiki 和 evidence 回答：

```bash
llmwiki query "1/e 为什么适合做失败概率基线？" --json
```

返回 answer + sources。

### 5.6 inspire

专门给 agent 产生启发：

```bash
llmwiki inspire "如何设计探索/利用策略？" --json
```

返回：
- 相关概念
- 反直觉点
- 可迁移框架
- 可操作建议
- 不确定性

---

## 6. Query / Inspire 检索优化

### 6.1 search 不依赖 LLM

先做本地检索：
- title
- tags
- kind
- claim
- evidence summary
- interpretation

短期使用 BM25-like keyword scoring。

### 6.2 query 使用 evidence

query prompt 输入不再是整页 markdown，而是结构化片段：

```text
Node: ...
Claim: ...
Evidence:
- ...
Interpretation:
- ...
```

回答必须引用 nodeId/filePath。

### 6.3 inspire 使用 counter/related

inspire 不追求“准确回答”，而追求“基于已知节点生成可迁移思路”。

输入：
- matched nodes
- counter nodes
- related links
- anchor nodes

输出：
- analogy
- tension
- decision heuristic
- next action

---

## 7. `e 的基本画像` 的 v5.0 目标结果

当前结果：

```text
3 个概念页 + 1 个反直觉页 + 1 个空 anchor
```

v5.0 应生成：

```text
concept/one-over-e-probability-limit
concept/exponential-time-constant
method/one-over-e-best-choice-law
method/greedy-submodular-approximation
equation/one-minus-one-over-n-limit
case/rc-circuit-time-constant
case/first-order-chemical-reaction
case/derangement-hat-check
insight/one-over-e-as-failure-baseline
counter/one-over-e-counterintuitive-failure-rate
anchor/one-over-e-essence
```

同时生成 coverage：

```text
已覆盖：
- 基本画像
- 哲学视角
- 数学原理
- 技术应用中的概率/时间/算法部分

未充分覆盖：
- 随机图
- 金融经济决策
- 参考文献
- 具体使用场景细节
```

成功标准：
- 每个节点有 evidence
- 每个 evidence 能回到 `raw/chase`
- agent 查询“1/e 在哪些场景出现”能召回多类节点
- agent inspire“探索利用策略”能用秘书问题节点给出启发

---

## 8. 实现阶段

### Phase 1: Schema First

文件：
- `types.ts`
- `knowledge/store.ts`
- `core/prefix.ts`

任务：
- 增加 `Evidence`, `WikiKind`, `WikiNodeDraft`, `CoverageItem`
- `Proposition` 增加 evidence/kind/confidence
- `WikiPage` 或新 `WikiNode` 支持结构化 sections
- 更新 prompt，强制 evidence

测试：
- parseProResult 能解析 evidence
- saveWikiNode 能渲染固定 Markdown

### Phase 2: Agent CLI

文件：
- `cli/commands/ingest.ts`
- 新增 `cli/commands/plan.ts`
- 新增 `cli/commands/audit.ts`

任务：
- `--auto`
- `--policy`
- `--json`
- `--dry-run`
- 退出码规范

测试：
- 无交互 ingest 不阻塞
- JSON 输出稳定
- 缺 API key 返回明确错误

### Phase 3: Coverage + Audit

文件：
- 新增 `knowledge/audit.ts`
- `knowledge/store.ts`

任务：
- 生成 source coverage report
- audit wiki evidence
- audit orphan node
- audit invalid chunkRefs

测试：
- 人为制造缺失 chunkRef，audit 必须失败
- `e 的基本画像` coverage 可读

### Phase 4: Query/Search/Inspire

文件：
- `query/engine.ts`
- 新增 `query/search.ts`
- 新增 `query/inspire.ts`

任务：
- search 返回结构化节点
- query 使用 evidence-aware context
- inspire 使用 kind/counter/related

测试：
- 查询能返回 source nodes
- inspire 不编造 raw 外事实，只做迁移和假设标注

### Phase 5: e2e Golden Tests

固定样本：
- `raw/original/pdf/e 的基本画像.pdf`
- `raw/original/md/graph-rag-paper.md`
- `raw/original/tex/arXiv-1503.02531v1/`

测试目标：
- 三格式都能生成 chase
- 三格式都能生成 schema-valid wiki
- audit 通过
- query 能引用 wiki 节点

---

## 9. 逐点优化矩阵

这一节把 v5.0 要优化的每个点拆成：当前问题、目标形态、具体改法、涉及文件、测试与验收。

### 9.1 Raw 层：只保留真正有用的中间层

当前状态：
- 已改成 `raw/original/<format>/` 与 `raw/chase/`
- `raw/chase` 已保存清洗后的 Markdown
- 但 chunk 边界还只存在于内存里，wiki 的 `chunkRefs` 无法稳定回查

v5.0 目标：
- `raw/original` 是源文件审计层
- `raw/chase` 是 LLM 真实输入层，也是 evidence 的回查层
- 不再保存无明确用途的中间产物
- chunk 边界必须写进 chase 文件本身，而不是额外散落 sidecar 文件

具体做法：
- `KnowledgeStore.saveRaw(source)` 写 `raw/chase/raw_<type>_<name>-<fingerprint>.md`
- chase frontmatter 增加：
  - `sourceId`
  - `sourcePath`
  - `sourceRoot`
  - `sourceType`
  - `fingerprint`
  - `chunkCount`
  - `loaderVersion`
- chase 正文插入稳定 chunk 标记：

```md
<!-- chunk:1 id=xxx charStart=0 charEnd=1280 -->
...
<!-- /chunk:1 -->
```

为什么有用：
- wiki evidence 可以直接引用 `raw/chase + chunkRef`
- audit 可以验证 chunk 是否存在
- 人可以打开 chase 文件审查“LLM 当时到底看了什么”
- 不需要再保存 brainstorm 原文、compile prompt、临时 JSON 等低价值产物

涉及文件：
- `lite-llmwiki/src/knowledge/store.ts`
- `lite-llmwiki/src/ingest/loader.ts`
- `lite-llmwiki/src/ingest/pdf-loader.ts`
- `lite-llmwiki/src/ingest/tex-loader.ts`
- `lite-llmwiki/tests/knowledge-store.test.ts`

测试：
- `saveRaw` 后 chase 文件包含所有 chunk 标记
- `readRaw` 能通过 sourceId 找回 chase
- markdown/pdf/tex 都能生成相同格式 chase
- source 已在 `raw/original` 下时不会重复复制

验收：
- 给定任意 wiki node 的 `sourceChase + chunkRefs`，都能定位到 chase 文件中的 chunk。

### 9.2 TeX 层：论文按项目文件夹处理

当前状态：
- `loadFromTex` 已支持 `sourceRoot`
- `saveRaw` 已能复制 TeX 项目文件夹
- 入口能从文件夹里找主 `.tex`

v5.0 目标：
- TeX 原始单位固定为项目文件夹
- chase 是合并后的可读论文 Markdown
- wiki evidence 必须能说明来自哪个 TeX 项目和主文件

具体做法：
- `findMainTex(dir)` 保持：优先找 `\documentclass`，否则用最大 `.tex`
- `loadFromTex(mainTex)` 设置：
  - `source.path = mainTex`
  - `source.sourceRoot = dirname(mainTex)`
  - `source.type = "tex"`
- TeX chase frontmatter 增加：
  - `mainTex`
  - `includedFiles`
  - `bblFile`
- `resolveTexIncludes` 继续展开 `\input` / `\include`
- 对无法解析的 include，在 chase 中保留 warning 注释，不静默丢失

涉及文件：
- `lite-llmwiki/src/cli/commands/ingest.ts`
- `lite-llmwiki/src/ingest/tex-loader.ts`
- `lite-llmwiki/src/knowledge/store.ts`

测试：
- 多 `.tex` 文件夹被作为一个 source 保存
- `raw/original/tex/<project>/` 保留完整目录
- 不出现 `raw/original/tex/main.tex` 这种扁平误存
- chase frontmatter 能看到主文件和 include 列表

验收：
- 一篇多 TeX 论文可以被 agent 当成一个材料 ingest、audit、query。

### 9.3 Extract：从“头脑风暴”改成“证据优先抽取”

当前状态：
- `brainstorm` 输出 `mainThreads + propositions`
- proposition 有 `claim/aiReading/chunkRefs`
- 没有 evidence 数组
- 没有 coverage
- claim 与 aiReading 的边界容易漂移

v5.0 目标：
- LLM 首轮不是自由 brainstorm，而是 evidence-bound extract
- 每条 proposition 必须绑定 evidence
- 每个 chunk 必须有 covered/skipped 说明

具体做法：
- `ProMode` 增加或语义替换为 `extract`
- 类型新增：

```ts
export type WikiKind =
  | "concept"
  | "claim"
  | "method"
  | "case"
  | "equation"
  | "question"
  | "insight"
  | "anchor"
  | "counter";

export interface Evidence {
  chunkRef: number;
  quote?: string;
  summary: string;
}

export interface CoverageItem {
  chunkRef: number;
  status: "covered" | "skipped";
  reason: string;
  importance: "high" | "medium" | "low";
}
```

- `Proposition` 增加：
  - `kind`
  - `evidence`
  - `confidence: "high" | "medium" | "low"`
  - `sourceId`
- prompt 明确：
  - 无 evidence 的 proposition 必须丢弃
  - quote 必须来自 chunk 原文
  - `claim` 只写原文可支持的事实
  - `aiReading` 只写解释和迁移，不冒充原文事实

涉及文件：
- `lite-llmwiki/src/types.ts`
- `lite-llmwiki/src/core/prefix.ts`
- `lite-llmwiki/src/ingest/listening.ts`

测试：
- `parseProResult` 能解析 evidence/coverage/kind/confidence
- 缺 evidence 的 proposition 被过滤或标记 invalid
- fallback 不生成高置信幻觉节点

验收：
- `e 的基本画像` 不再只产出 3 个泛概念，而是产出一组带 evidence 的原子节点候选。

### 9.4 Confirm：人类对齐和 agent 自动确认并存

当前状态：
- CLI 需要人工输入 `a/s/m/a all`
- agent 调用会卡住
- 没有策略化自动确认

v5.0 目标：
- human 模式继续支持深度对齐
- agent 模式可完全非交互
- 自动确认必须可解释、可审计

具体做法：
- `ingest` 新增参数：
  - `--auto`
  - `--policy conservative|balanced|expansive`
  - `--dry-run`
  - `--json`
  - `--resume <runId>`
- policy 规则：
  - `conservative`: 只确认 high confidence 且 evidence 完整的 concept/method/case/equation
  - `balanced`: high/medium 均可确认，但 question/insight 需要 evidence
  - `expansive`: 允许更多 insight/counter/question，但必须标注 limits
- 确认结果写入内存，默认不额外落盘；若 `--dry-run --json`，直接输出候选和覆盖报告

涉及文件：
- `lite-llmwiki/src/cli/commands/ingest.ts`
- 新增 `lite-llmwiki/src/ingest/policy.ts`
- `lite-llmwiki/src/types.ts`

测试：
- `llmwiki ingest <file> --auto --policy conservative --json` 不读取 stdin
- policy 能正确过滤 low confidence
- `--dry-run` 不写 wiki，只写/可选写 raw chase

验收：
- Claude Code/opencode/Codex 可以安全调用 ingest，不会被交互卡住。

### 9.5 Compile：LLM 输出结构，本地渲染 Markdown

当前状态：
- compile 让 LLM 直接输出 `body`
- 页面格式漂移大
- 很难区分事实、解释、用途和限制

v5.0 目标：
- LLM 只输出结构化 `WikiNodeDraft[]`
- Markdown 由本地 deterministic renderer 生成
- 所有 wiki 节点格式一致，便于 agent 解析

具体做法：
- 新增类型：

```ts
export interface WikiFrontmatter {
  nodeId: string;
  kind: WikiKind;
  title: string;
  sourceIds: string[];
  sourceChase: string[];
  chunkRefs: number[];
  confidence: number;
  status: "draft" | "verified" | "needs_review";
  tags: string[];
  related: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WikiNodeDraft {
  nodeId: string;
  kind: WikiKind;
  filePath: string;
  frontmatter: WikiFrontmatter;
  claim: string;
  evidence: Evidence[];
  interpretation?: string;
  useFor?: string[];
  limits?: string[];
  links?: string[];
}
```

- 新增 renderer：
  - frontmatter 用固定 YAML serializer
  - body 固定为 `Claim / Evidence / Interpretation / Use For / Limits / Links`
  - 空 section 不输出
- `saveWikiPage` 保持兼容旧页面
- 新增 `saveWikiNode` 写 v5 节点

涉及文件：
- `lite-llmwiki/src/types.ts`
- `lite-llmwiki/src/knowledge/store.ts`
- 新增 `lite-llmwiki/src/knowledge/render.ts`
- `lite-llmwiki/src/ingest/listening.ts`

测试：
- 同一个 `WikiNodeDraft` 多次渲染完全一致
- frontmatter 数组能正确渲染
- evidence 为空时 renderer 抛错或 status 降为 `needs_review`

验收：
- wiki 文件可读，也可被 agent 稳定解析。

### 9.6 Audit：把“像不像第二大脑”变成可测试条件

当前状态：
- 没有 audit
- wiki 与 raw 差异只能靠人工读
- 无法批量判断语义漂移

v5.0 目标：
- 每次 ingest 后都可以运行 audit
- audit 能发现证据缺失、chunkRef 失效、quote 不存在、coverage 低、节点孤立等问题

具体做法：
- 新增 `knowledge/audit.ts`
- 新增 `llmwiki audit`
- 检查项：
  - `sourceChase` 文件存在
  - `chunkRefs` 在 chase 中存在
  - `evidence` 非空
  - `evidence.quote` 若存在，必须能在对应 chunk 中找到
  - `claim` 不能没有 evidence
  - `kind` 合法
  - `nodeId/filePath` 与 kind 匹配
  - coverage 未覆盖 chunk 有 reason
- 输出：

```json
{
  "ok": false,
  "summary": {
    "nodes": 11,
    "verifiedNodes": 9,
    "missingEvidence": 1,
    "invalidChunkRefs": 0,
    "coverage": 0.82
  },
  "issues": [
    {
      "severity": "error",
      "filePath": "wiki/concepts/...",
      "message": "missing evidence"
    }
  ]
}
```

涉及文件：
- 新增 `lite-llmwiki/src/knowledge/audit.ts`
- 新增 `lite-llmwiki/src/cli/commands/audit.ts`
- `lite-llmwiki/src/cli/index.ts`

测试：
- 人为删掉 evidence，audit 失败
- 人为写错 chunkRef，audit 失败
- legacy v4 页面被标记为 `needs_migration` 而不是误判通过

验收：
- 能用命令判断某批 wiki 是否值得 agent 信任。

### 9.7 Search：本地结构化检索，不默认调用 LLM

当前状态：
- `searchWikiPages` 只是关键词匹配整页文本
- 返回 `filePath/title`
- 无 kind、score、evidence

v5.0 目标：
- search 是快速、稳定、无 LLM 的本地能力
- 返回 agent 可消费的结构化节点

具体做法：
- 新增 `query/search.ts`
- 解析 v5 wiki frontmatter 和 sections
- BM25-like 打分字段权重：
  - title: 4
  - tags: 3
  - claim: 3
  - evidence summary: 2
  - interpretation/useFor: 1
- `llmwiki search <query> --json`
- 返回：
  - `nodeId`
  - `kind`
  - `title`
  - `score`
  - `claim`
  - `evidence`
  - `filePath`

涉及文件：
- `lite-llmwiki/src/query/search.ts`
- `lite-llmwiki/src/knowledge/store.ts`
- 新增 `lite-llmwiki/src/cli/commands/search.ts`

测试：
- 查询“失败概率”能命中 probability limit 节点
- 查询“探索利用”能命中 secretary/method 节点
- 无 API key 也能 search

验收：
- agent 不调用 LLM 也能快速拿到相关记忆。

### 9.8 Query：只基于 evidence 回答

当前状态：
- query 把整页 markdown 塞给 LLM
- sourcePages 只有文件路径
- 回答可能吸收页面里的衍生解释，却无法说明证据边界

v5.0 目标：
- query 的上下文只包含结构化节点和 evidence
- 回答必须返回 sources
- 对 raw 不支持的推断要标注为 inference

具体做法：
- `queryKnowledge` 先调用本地 `search`
- 组装 context：

```text
Node: concept/...
Claim: ...
Evidence:
- chunk 1: ...
Interpretation:
- ...
Limits:
- ...
```

- prompt 规则：
  - 事实回答只用 claim/evidence
  - 可迁移建议必须标注“基于 wiki 的推断”
  - 不足时返回 missing evidence
- `--json` 输出：
  - `answer`
  - `sources`
  - `inferences`
  - `missingEvidence`

涉及文件：
- `lite-llmwiki/src/query/engine.ts`
- `lite-llmwiki/src/query/search.ts`
- `lite-llmwiki/src/cli/commands/query.ts`

测试：
- query 返回 sources 中包含 nodeId/chunkRefs
- query 不应引用没有 evidence 的 legacy 页面，除非用户加 `--include-legacy`

验收：
- agent 可以把 query 结果直接贴进自己的任务上下文，并知道可信边界。

### 9.9 Inspire：把启发与事实回答分开

当前状态：
- 反直觉文件存在，但没有专门 inspire 命令
- query 和启发混在一起，容易让 agent 分不清事实与迁移

v5.0 目标：
- `query` 回答“wiki 里知道什么”
- `inspire` 回答“基于 wiki 可以迁移出什么想法”
- inspire 必须保留 evidence 来源和 inference 标注

具体做法：
- 新增 `query/inspire.ts`
- 输入：
  - search matched nodes
  - `kind=counter` 节点
  - `kind=anchor` 节点
  - related links
- 输出结构：
  - `seedNodes`
  - `analogies`
  - `tensions`
  - `decisionHeuristics`
  - `nextActions`
  - `uncertainties`
- 对每条启发标注：
  - `basedOn: nodeId[]`
  - `inferenceLevel: low|medium|high`

涉及文件：
- 新增 `lite-llmwiki/src/query/inspire.ts`
- 新增 `lite-llmwiki/src/cli/commands/inspire.ts`

测试：
- `inspire "如何设计探索/利用策略"` 能召回 secretary method
- 输出中事实与推断分开
- 没有相关节点时不硬编，返回 `seedNodes: []`

验收：
- 第二大脑不仅能查，还能给 agent 产生可追溯的迁移灵感。

### 9.10 Index：给 agent 一个机器入口

当前状态：
- `wiki/index.md` 偏人读
- agent 需要遍历文件才能知道有哪些节点

v5.0 目标：
- 保留 `wiki/index.md`
- 新增 `wiki/index.json` 作为机器 manifest
- 不引入复杂数据库作为 v5 必需项

具体做法：
- `rebuildIndex()` 同时写：
  - `wiki/index.md`
  - `wiki/index.json`
- `index.json` 包含：
  - `nodeId`
  - `kind`
  - `title`
  - `filePath`
  - `sourceIds`
  - `tags`
  - `confidence`
  - `updatedAt`
- search 优先读 `index.json`，缺失时回退扫描 markdown

涉及文件：
- `lite-llmwiki/src/knowledge/store.ts`
- `lite-llmwiki/src/query/search.ts`

测试：
- 保存节点后 rebuild index 生成 JSON
- index 里不收录无效/legacy 节点，或标记 `legacy: true`

验收：
- agent 可以先读 `wiki/index.json` 再决定查询哪些节点。

### 9.11 Migration：旧 wiki 不直接冒充 v5 节点

当前状态：
- 已有 `e 的基本画像` 页面是 v4 风格
- frontmatter 缺少 `kind/sourceChase/chunkRefs/evidence`

v5.0 目标：
- legacy 页面可保留
- 新 audit 不把 legacy 当成 verified v5 节点
- 推荐用原 raw 重新生成 v5 节点

具体做法：
- audit 检测缺少 `nodeId/kind/sourceChase/evidence` 的页面，标记：
  - `status: legacy`
  - `issue: needs_migration`
- 提供迁移命令：

```bash
llmwiki ingest "raw/original/pdf/e 的基本画像.pdf" --auto --policy conservative --json
```

- 迁移时不覆盖旧页面，写入 v5 路径：
  - `wiki/concepts/...`
  - `wiki/methods/...`
  - `wiki/cases/...`
  - `wiki/equations/...`

涉及文件：
- `lite-llmwiki/src/knowledge/audit.ts`
- `lite-llmwiki/src/knowledge/store.ts`

测试：
- 当前 3 个 e 页面应被识别为 legacy
- 重新 ingest 后 v5 节点 audit 通过

验收：
- 不会把缺证据的旧总结误喂给 agent 当可靠记忆。

### 9.12 Golden E2E：用 e 的基本画像定义“像第二大脑”的标准

当前状态：
- e 样本已有 raw/chase/wiki 对照
- 现有 wiki 抓住主概念，但覆盖不够、证据链不够

v5.0 目标结果：
- 至少生成 8 个 v5 节点
- 覆盖概率、时间常数、秘书问题、贪心近似、物理/化学案例、反直觉洞察
- 每个节点都有 evidence

验收查询：
- `llmwiki search "1/e 在哪些场景出现" --json`
- `llmwiki query "为什么 1/e 可以作为失败概率基线？" --json`
- `llmwiki inspire "如何设计探索和利用策略？" --json`

通过标准：
- search 至少召回 5 类 kind
- query sources 至少包含 2 个不同节点
- inspire 明确区分 evidence 与 inference
- audit `ok: true`

涉及测试：
- `tests/knowledge-store.test.ts`
- 新增 `tests/wiki-render.test.ts`
- 新增 `tests/audit.test.ts`
- 新增 `tests/search.test.ts`
- 新增 `tests/agent-cli.test.ts`

---

## 10. 保存策略：哪些东西值得存，哪些不值得

v5.0 只把长期有复用价值的东西落盘。

必须保存：
- `raw/original`: 原始文件。用于版权/真实性/人工复核/重新清洗。
- `raw/chase`: 清洗后 Markdown。用于复现 LLM 输入、定位 chunk、审查 PDF/TeX 转换质量。
- `wiki/**/*.md`: 第二大脑节点。用于人读、agent 读、长期积累。
- `wiki/index.json`: 机器 manifest。用于 agent 快速发现节点。
- `wiki/log.md`: 操作日志。用于知道何时 ingest 了什么。

默认不保存：
- 每次 LLM prompt 全量副本
- brainstorm 临时响应
- compile 临时响应
- 自动确认过程中的中间 JSON
- 重复的 raw 扁平目录
- 没被确认的 proposition

可选调试保存：
- 只有加 `--debug-run` 时，才写 `runs/<runId>/`
- 里面可放 prompt/response/policy decision
- `runs/` 不作为第二大脑内容，只用于调试

判断标准：
- 能帮助 audit、query、reingest、人工复核、agent 调用的，保存。
- 只是过程噪声、会造成目录膨胀、不能稳定复用的，不保存。

---

## 11. v5.0 实施顺序

### Step 1: Schema First

先改类型，不改业务行为。

任务：
- 在 `types.ts` 增加 `WikiKind/Evidence/CoverageItem/WikiNodeDraft/WikiFrontmatter`
- 保留旧 `WikiPage` 兼容
- `Proposition/ConfirmedProposition` 增加 evidence/kind/confidence/sourceId

测试：
- 类型编译通过
- 旧知识库测试仍通过

### Step 2: Chase Chunk Markers

让 raw/chase 成为可审计证据层。

任务：
- `saveRaw` 写 chunk 标记
- `readRaw` 支持读取并解析 chunk
- TeX chase 记录 mainTex/includedFiles

测试：
- md/pdf/tex 三格式 chase 都可定位 chunk

### Step 3: Renderer

把 wiki 写法从 LLM 自由文本改成本地渲染。

任务：
- 新增 `renderWikiNode`
- 新增 `saveWikiNode`
- frontmatter 数组/数字/字符串稳定序列化

测试：
- snapshot 或 exact string 测试

### Step 4: Extract Prompt + Parser

把 brainstorm 升级为 evidence-first extract。

任务：
- 更新 `PRO_SYSTEM`
- 更新 `parseProResult`
- 增加 coverage 解析
- 缺 evidence 的 proposition 不进入确认列表

测试：
- mock LLM JSON 解析
- invalid JSON fallback 安全

### Step 5: Agent CLI

让外部 agent 可以稳定调用。

任务：
- `ingest --auto --policy --json --dry-run`
- 新增 `plan`
- JSON 输出统一 `{ ok, data, issues }`
- 退出码规范：
  - `0`: ok
  - `1`: runtime/config error
  - `2`: audit/validation failed

测试：
- 不需要 stdin
- 无 API key 错误 JSON 化

### Step 6: Audit

把质量控制本地化。

任务：
- 新增 audit engine
- 新增 `llmwiki audit`
- ingest 后自动跑一次 audit，失败时 JSON 输出 issues

测试：
- 缺 evidence/坏 chunkRef/legacy 页面都能识别

### Step 7: Search / Query / Inspire

把第二大脑能力开放给 agent。

任务：
- 新增本地 search
- query 使用 evidence-aware context
- inspire 使用 seed/counter/anchor/related

测试：
- 无 API key 可 search
- query/inspire 返回 sources

### Step 8: Golden E2E

用真实三格式材料收口。

任务：
- md/pdf/tex 三条 ingest
- `e 的基本画像` 重新生成 v5 节点
- audit/search/query/inspire 全链路验收

测试：
- `npx vitest run`
- `npm run typecheck`
- 有 API key 时运行真实 e2e；无 API key 时跑 mock e2e

---

## 12. 当前 wiki 与目标 wiki 的差距判断

以 `e 的基本画像` 为例，当前 wiki 的价值是“提炼出主题”，但还不是“agent 可长期信任的第二大脑”。

已经做到：
- 抓住了 `1/e` 的概率极限、指数衰减、最优停止/贪心算法三条主线
- 有一定反直觉解释
- 人类阅读时有启发

没有做到：
- 缺 `sourceChase`
- 缺 `chunkRefs` 的稳定回查
- 缺 `Evidence` section
- 缺 coverage report
- 页面粒度偏大
- `case/method/equation/insight/counter` 没有清晰分型
- query 不能返回机器可用 source list

v5.0 后，判断 wiki 是否达标不再靠主观感觉，而看五个条件：
- Traceable: 每个 claim 都能回到 raw/chase chunk
- Atomic: 每个页面只有一个知识节点
- Queryable: 本地 search 能召回 node/evidence
- Usable: 每个节点有 useFor/limits
- Inspiring: inspire 能基于节点生成带来源的迁移想法

这五项同时满足时，wiki 才接近“agent 的第二大脑”，而不是“LLM 写过的一批摘要”。

## 13. 不做或暂缓

暂缓：
- embedding 向量库
- SQLite 图谱
- OCR/扫描 PDF
- 多用户同步
- web UI

原因：
- 当前最大缺口不是召回算法，而是 wiki 节点质量和 agent 契约
- 文件系统 + schema + audit 先跑通，更符合 CLI 产品形态

---

## 14. Graph 窗口：初代不做图谱，但保留生长接口

v5.0 不直接引入 graph database，也不把“自动推理图谱”作为首发能力。但 v5.0 的节点设计必须保证：当 wiki 足够庞大时，可以从现有文件自然抽取出图，而不需要推翻 wiki 格式。

### 14.1 设计原则

- 当前产品形态仍是 file-first：`raw/chase + wiki markdown + index.json`
- graph 是未来增强层，不是 v5.0 的可信源
- wiki node 才是事实和解释的主存储
- graph 只从 wiki node 派生，不反向覆盖原始节点
- 任何 graph edge 都必须能回到 source node 和 evidence

### 14.2 v5.0 必须保留的 graph-ready 字段

每个 v5 wiki node 至少保留：

```yaml
nodeId: concept/one-over-e-probability-limit
kind: concept
sourceIds:
  - raw_pdf_e 的基本画像-101349df399af024
sourceChase:
  - raw/chase/raw_pdf_e 的基本画像-101349df399af024.md
chunkRefs:
  - 1
  - 2
tags:
  - probability
  - one-over-e
related:
  - concept/exponential-time-constant
```

这些字段未来可以直接派生 graph：

| 字段 | 未来图谱用途 |
|---|---|
| `nodeId` | graph node primary key |
| `kind` | node label/type |
| `sourceIds` | `DERIVED_FROM` 边 |
| `sourceChase + chunkRefs` | evidence provenance |
| `tags` | topic/community clustering |
| `related` | 显式 `RELATED_TO` 边 |
| `links` | markdown/wiki link 派生边 |
| `useFor` | capability/use-case 聚类 |
| `limits` | contradiction/caveat 检索 |

### 14.3 v5.0 暂时只做轻量边

v5.0 允许保存显式关系，但不做复杂图推理。

允许：
- `related: [...]`
- `links: [...]`
- `sourceIds`
- `tags`
- `kind`

暂缓：
- 自动关系抽取
- 多跳推理
- community detection
- centrality/rank
- graph embedding
- SQLite/Neo4j/向量图混合检索

### 14.4 未来 graph 能萌生出的功能

当 wiki 节点数量足够大时，graph 层可以逐步提供：

- **概念邻域**：给定一个节点，找相邻概念、方法、案例、反例
- **跨材料合并**：多个 raw 来源指向同一 node 时，形成 stronger memory
- **矛盾/张力发现**：不同节点的 limits、counter、claim 出现冲突时提示用户
- **启发路径**：从当前任务沿 `method -> case -> counter -> insight` 走出迁移链
- **遗忘/陈旧检测**：长期孤立、无 source、无查询命中的节点降权
- **agent planning**：agent 根据 graph 选择先 query 哪些节点，再 inspire 哪些路径

### 14.5 v5.0 对 graph 的验收要求

v5.0 不验收 graph 功能本身，只验收“未来可建图”的基础条件：

- 所有节点有稳定 `nodeId`
- 所有节点有 `kind`
- 所有节点能回到 source/evidence
- `related/links/tags` 格式稳定
- `wiki/index.json` 足以列出全部节点及基本元数据
- audit 能发现断掉的 `related` / `links`

如果这些条件成立，未来 graph 可以作为派生索引自然生成：

```text
wiki/**/*.md -> parse frontmatter/body -> graph index -> search/query/inspire enhancement
```

这样 graph 是从第二大脑里“长出来”的，而不是在第二大脑还没稳定时强行压上去。

---

## 15. v5.0 成功标准

v5.0 完成后，以下命令应该可被 agent 稳定调用：

```bash
llmwiki ingest raw/original/pdf/e\ 的基本画像.pdf --auto --policy conservative --json
llmwiki audit --json
llmwiki search "1/e 失败概率" --json
llmwiki query "1/e 为什么常作为失败概率基线？" --json
llmwiki inspire "如何设计探索和利用的决策策略？" --json
```

并且满足：

- wiki 每页都有 evidence
- wiki 每页都能回到 raw/chase
- query 回答有 source nodes
- inspire 输出区分事实、迁移、假设
- ingest 可以非交互运行
- audit 可以发现证据链断裂
- `e 的基本画像` 不再只产出 3 个概念短文，而是形成一组可查询、可组合的知识节点

---

## 16. 优先级排序

最高优先级：
1. Wiki node schema
2. evidence + chunkRefs
3. `--auto --json`
4. audit

第二优先级：
5. coverage
6. search
7. query evidence-aware

第三优先级：
8. inspire
9. cross-page link refinement
10. resume

理由：
没有 schema/evidence/agent CLI，后面的 query 和 inspire 都只是建立在松散 Markdown 上，无法成为可靠第二大脑。
