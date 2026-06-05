# LiteWikiagent v6.0 产品详细设计文档

Date: 2026-06-04

## 1. 一句话定位

LiteWikiagent 是一个 agent-first 的个人知识编译器：用户选择材料，系统把材料编译成可审计 wiki，agent 在 wiki 提供的结构局面中进行查询、推理和启发。

v6.0 的关键变化不是增加更多“规则”来约束 LLM，而是把 wiki 设计成 LLM 的局面输入：

```text
用户负责选材
系统负责忠实编译与审查
wiki 负责承载用户已经理解和认可过的结构
LLM 负责高水平推理、综合、发散
agent 负责按协议调用工具
```

产品不试图教 LLM 怎么思考。LLM 本身已经具备强大的推理和发散能力。v6.0 要做的是：把用户的知识结构、来源证据、概念边界、已有问题和潜在张力摆到 LLM 面前，让它在用户自己的第二大脑中工作。

## 2. 设计哲学

### 2.1 用户选材，不做入库门控

`raw/original/` 本身就是用户意图信号。

只要用户把材料放进来，系统不再判断“值不值得入库”。原因：

- 只有用户知道一份材料为什么对自己重要；
- 入库价值判断会增加摩擦；
- 系统做价值判断容易误伤非显性价值材料；
- 产品目标不是替用户决定读什么，而是把用户已经选定的材料编译好。

因此 v6.0 明确不设计：

- 入库理由强制填写；
- 材料价值评分；
- 自动拒绝入库；
- 适用场景门控；
- 用户动机审查。

产品质量闸门不在 raw 入口，而在 wiki 产物：

```text
raw 是否值得进来：用户决定
wiki 是否忠实可靠：系统审查
agent 是否可以使用：audit 决定
```

### 2.2 Wiki 是局面，不是教材

v6.0 对 query 的核心理解：

```text
LLM = 下棋高手
wiki = 用户已经编译出的棋盘局面
query mode = 摆盘方式
agent = 负责把局面摆给 LLM 的执行者
```

所以 query mode 不应该是“要求 LLM 按某个低级模板推理”。它应该决定：

- 召回哪些 wiki 节点；
- 是否带上 source/chase evidence；
- 是否带上 limits、counter、questions、anchors；
- 是否带上相邻节点和历史相关问题；
- 输出时如何区分 wiki 内容、模型推理和缺失依据。

LLM 的推理空间需要保留。v6.0 只要求它不要脱离 wiki 所提供的用户知识结构。

### 2.3 审查对象是语义忠实度

当前 v5 已经有结构审查：

- 是否有 `nodeId`;
- 是否有 `kind`;
- 是否有 `sourceChase`;
- `chunkRefs` 是否存在；
- 是否有 `Claim` 和 `Evidence` section。

v6.0 要增加语义审查：

- claim 是否能被 chase 原文支持；
- 是否引入原文没有的强判断；
- 是否把解释、类比、应用写成事实；
- 是否遗漏原文的重要限制条件；
- evidence 是否真的支撑 claim，而不是只和 claim 主题相似；
- inference 是否被明确标注。

这不是限制 LLM 的发散能力，而是保证 wiki 层本身可靠。只有可靠 wiki 才能作为后续局面输入。

### 2.4 Agent Contract 是硬协议

LiteWikiagent 的主用户之一是 Reasonix、Codex、Claude Code、opencode 等 agent。

agent 不应该自由猜测 wiki 状态，而应该遵守固定流程：

```text
plan -> ingest -> audit -> search/query/inspire
```

如果 `audit` 失败，agent 必须停止后续问答，并返回：

- 失败原因；
- 失败节点；
- 缺失证据；
- 无效 chunkRefs；
- 建议操作。

这条协议是 v6.0 的产品边界：agent 可以高度自主，但不能绕过审查把未验证 wiki 当作第二大脑使用。

## 3. 当前基础

v6.0 基于当前 v5 基础升级，不推翻现有工程。

当前已具备：

- `raw/original/md/`、`raw/original/pdf/`、`raw/original/tex/<paper-project-folder>/`;
- `raw/chase/` 清洗 Markdown 中间层；
- TeX 文件夹作为论文源单元处理；
- wiki 节点分目录保存；
- v5 frontmatter；
- `sourceChase` 和 `chunkRefs`;
- `audit --json`;
- `search --json`;
- `query --json`;
- `inspire --json` 基础版本；
- `plan <path> --json`;
- agent 可用的非交互 ingest：`ingest <path> --auto --policy conservative --json`。

当前不足：

- audit 仍偏结构，不足以判断语义漂移；
- query context packing 仍偏简单检索；
- query mode 尚未产品化；
- inspire 只是基础抽样，不是真正的局面式启发；
- agent contract 还没有成为测试保证；
- wiki manifest 还不足以支撑未来 graph 构建。

## 4. v6.0 产品目标

### 4.1 核心目标

v6.0 要让 LiteWikiagent 成为稳定的 agent second-brain substrate。

一个外部 agent 应该能够：

1. 接收用户给出的 raw 文件路径；
2. 判断该路径能否被处理；
3. 将 raw 编译为 chase 和 wiki；
4. 自动审查 wiki 是否可用；
5. 根据用户问题摆出合适 wiki 局面；
6. 调用 LLM 在该局面上回答、比较、挑战或启发；
7. 明确告诉用户哪些内容来自 wiki，哪些是模型推理，哪些缺少依据。

### 4.2 非目标

v6.0 不做：

- raw 入库价值判断；
- 完整 graph 产品；
- 多用户权限；
- 云端同步；
- UI 应用；
- embedding/vector search 作为必选依赖；
- 强制 Obsidian 集成；
- 用固定模板限制 LLM 推理路线。

### 4.3 成功标准

v6.0 成功不是“生成更多 wiki”，而是：

- wiki 节点能被追溯到 chase；
- wiki claim 与 source evidence 语义一致；
- agent 可稳定按 JSON 协议自动化调用；
- query 能根据模式正确摆出上下文局面；
- LLM 的回答能保留自由推理，同时清楚区分 wiki、inference、missing evidence；
- inspire 能基于 wiki 产生有结构的发散，而不是随机联想。

## 5. 存储结构设计

### 5.1 目录结构

v6.0 继续沿用当前结构：

```text
raw/
  original/
    md/
    pdf/
    tex/
      <paper-project-folder>/
  chase/
wiki/
  concepts/
  methods/
  cases/
  equations/
  questions/
  insights/
  anchors/
  counters/
  index.md
  index.json
  log.md
spec/
spec_process/
helper/
lite-llmwiki/
```

说明：

- `raw/original/`：用户放入的原始材料，不做价值门控；
- `raw/chase/`：清洗后的 Markdown，是审查与回放的关键层；
- `wiki/`：LLM 编译后的知识结构；
- `wiki/index.json`：未来 graph/import/search 的稳定 manifest；
- `wiki/log.md`：操作时间线。

### 5.2 Chase 层原则

`raw/chase/` 是 v6.0 的审查基准层。

它必须满足：

- 每次 ingest 都写入 chase；
- chase 文件包含稳定 chunk marker；
- wiki node 的 `sourceChase` 指向 chase；
- wiki node 的 `chunkRefs` 可在 chase 中定位；
- semantic audit 读取 chase excerpt，而不是重新解析 PDF/TeX。

PDF 和 TeX 的 raw 解析会受到工具、排版、公式、引用的影响。chase 是进入 LLM 前的稳定文本层，因此它是 audit 和 query 的共同事实界面。

## 6. Wiki Node v6 Schema

### 6.1 Frontmatter

v6.0 在 v5 基础上扩展，但保持向后兼容。

```yaml
nodeId: stable-node-id
kind: concept
title: Node title
sourceIds:
  - raw/pdf/source-id
sourceChase:
  - raw/chase/raw_pdf_source-id.md
chunkRefs:
  - 1
confidence: 0.9
status: verified
tags:
  - example
related: []
createdAt: "2026-06-04T00:00:00.000Z"
updatedAt: "2026-06-04T00:00:00.000Z"

# v6 additions
auditStatus: pending
auditScore: null
claimType: source_claim
inferenceLevel: none
propRefs: []
claimHash: null
boardRoles:
  - evidence
  - concept
```

### 6.2 字段说明

`auditStatus`:

```text
pending | passed | warning | failed
```

表示 semantic audit 的结果。结构 audit 通过不等于 semantic audit 通过。

`auditScore`:

```text
0.0 - 1.0
```

语义对齐评分。MVP 可先由 LLM judge 给出，后续可加入轻量规则信号。

`claimType`:

```text
source_claim | interpretation | application | analogy | question | counter
```

区分节点主张性质。它不限制 LLM 使用节点，而是帮助 board setup 正确摆局。

`inferenceLevel`:

```text
none | light | medium | strong
```

表示节点离原文的推理距离。

`propRefs`:

confirmed proposition 的 ID。用于追踪“哪个 proposition 编译成了哪个节点”。

`claimHash`:

claim 的稳定哈希。用于去重、更新和未来 graph 边构建。

`boardRoles`:

节点在 query board 中可扮演的角色：

```text
evidence | concept | method | case | limit | counter | question | anchor | bridge
```

它不是知识类型本身，而是上下文装配时的用途。

### 6.3 Body Sections

v6.0 保留 v5 sections：

```text
## Claim
## Evidence
## Interpretation
## Use For
## Limits
## Links
```

新增推荐 sections：

```text
## Audit Notes
## Board Use
```

`Audit Notes` 保存 semantic audit 的人类可读说明。

`Board Use` 描述该节点适合在什么 query 局面中被召回，例如：

```text
- 作为 exact answer 的证据
- 作为 explore 的相邻概念
- 作为 challenge 的限制条件
- 作为 inspire 的弱连接种子
```

## 7. Semantic Audit 设计

### 7.1 目标

Semantic Audit 的目标是判断 wiki node 是否忠实于 chase 原文。

它不判断 raw 材料是否正确，也不判断用户是否应该相信材料。它只判断：

```text
wiki 是否忠实表达了 raw/chase 中已有的内容
```

### 7.2 审查维度

每个 node 至少审查五个维度：

| 维度 | 问题 | 结果 |
| --- | --- | --- |
| support | Claim 是否被 evidence 支持 | aligned / stretched / unsupported |
| addition | 是否加入原文没有的新主张 | none / minor / major |
| inference | 是否把推理标成事实 | ok / warning / failed |
| limits | 是否遗漏限制条件 | ok / warning / failed |
| citation | chunkRefs 是否覆盖关键 evidence | ok / warning / failed |

### 7.3 输出 JSON

```json
{
  "ok": true,
  "summary": {
    "nodes": 9,
    "passed": 8,
    "warning": 1,
    "failed": 0,
    "averageScore": 0.91
  },
  "issues": [
    {
      "nodeId": "example-node",
      "filePath": "wiki/concepts/example-node.md",
      "severity": "warning",
      "dimension": "limits",
      "claim": "...",
      "evidenceExcerpt": "...",
      "reason": "The claim is supported, but an important assumption in the source was not carried into Limits.",
      "suggestedFix": "Add the missing assumption to Limits."
    }
  ]
}
```

### 7.4 CLI

保留当前结构 audit：

```bash
llmwiki audit --json
```

新增 semantic audit：

```bash
llmwiki audit --semantic --json
llmwiki audit --semantic --source <sourceId> --json
llmwiki audit --semantic --node <nodeId> --json
```

agent 默认流程：

```bash
llmwiki audit --json
llmwiki audit --semantic --json
```

### 7.5 实现策略

第一阶段使用 LLM judge：

输入：

- node frontmatter；
- `## Claim`;
- `## Evidence`;
- `## Interpretation`;
- `## Limits`;
- referenced chase chunks。

输出：

- JSON-only；
- score；
- issue list；
- suggested fix。

第二阶段加入规则辅助：

- claim/evidence overlap；
- unsupported absolute language 检测；
- limits 空缺检测；
- chunkRefs 覆盖检查；
- inference markers 检测。

第三阶段加入自动修复建议：

```bash
llmwiki audit --semantic --fix-draft --json
```

只生成修复草案，不自动覆盖 wiki。

## 8. Query Board 设计

### 8.1 核心定义

v6.0 不把 query mode 定义成推理规则，而定义成 board setup。

```typescript
interface QueryBoard {
  mode: BoardMode;
  question: string;
  seedNodes: BoardNode[];
  evidenceNodes: BoardNode[];
  relatedNodes: BoardNode[];
  limitNodes: BoardNode[];
  counterNodes: BoardNode[];
  questionNodes: BoardNode[];
  sourceExcerpts: SourceExcerpt[];
  gaps: BoardGap[];
  instructions: BoardInstruction;
}
```

`BoardInstruction` 不是教 LLM 逐步推理，而是告诉它当前局面里有哪些材料，以及输出需要标注哪些来源边界。

### 8.2 Mode 命名

建议 v6.0 避免使用 `exact/explore` 这种容易被理解为“限制思维方式”的命名，改成更接近上下文装配的命名：

```text
ask
trace
expand
compare
challenge
inspire
```

兼容层可以保留旧名 alias：

```text
exact -> trace
explore -> expand
counter -> challenge
```

### 8.3 ask

普通问答局面。

装配：

- top relevant nodes；
- claim；
- evidence；
- limits；
- minimal source refs。

适用：

- “这个概念是什么意思？”
- “材料里怎么解释这个问题？”
- “我之前对这个点有什么记录？”

输出要求：

- 回答用户问题；
- 标注引用节点；
- 当 wiki 不足时说明缺口；
- 可自由综合，但不要把模型推理伪装成 wiki 原文。

### 8.4 trace

来源追溯局面。

装配：

- relevant nodes；
- full evidence section；
- referenced chase excerpts；
- sourceId；
- chunkRefs。

适用：

- “这个判断从哪来？”
- “wiki 有没有偏离原文？”
- “给我看依据。”

输出要求：

- 优先说明来源链；
- 对每个主张给出对应 evidence；
- 明确哪些内容是原文支持，哪些是解释。

### 8.5 expand

扩展理解局面。

装配：

- seed nodes；
- related nodes；
- methods/cases/equations；
- anchors/questions；
- light limits。

适用：

- “基于这个观点还能怎么理解？”
- “这个材料能怎么用于我的项目？”
- “它和我已有知识有什么连接？”

输出要求：

- 允许模型自由推演；
- 输出中分开 `fromWiki`、`modelSynthesis`、`openQuestions`；
- 不要求每句话都有引用，但关键落点必须能回到 wiki 结构。

### 8.6 compare

比较局面。

装配：

- 两组或多组 seed nodes；
- 各自 claim/evidence/limits；
- shared tags；
- possible bridge nodes；
- contradiction/tension candidates。

适用：

- “这两个观点有什么区别？”
- “这几篇材料的框架差异是什么？”
- “它们是否在说同一件事？”

输出要求：

- 自由比较；
- 输出相同点、差异、张力、可合并之处；
- 标注比较依据来自哪些 nodes。

### 8.7 challenge

挑战与审查局面。

装配：

- target claim node；
- limit nodes；
- counter nodes；
- weak evidence nodes；
- missing evidence；
- adjacent conflicting claims。

适用：

- “这个观点站得住吗？”
- “它的前提是什么？”
- “哪里可能错？”
- “有没有反例或限制？”

输出要求：

- 模型可以尖锐审查；
- 明确区分 source-backed challenge 和 model-generated challenge；
- 输出可验证的后续检查问题。

### 8.8 inspire

启发局面。

装配：

- seed node 或 seed query；
- weakly related nodes；
- insights；
- questions；
- counters；
- anchors；
- bridges；
- recent nodes。

适用：

- “给我一些新问题。”
- “基于我的知识库启发我。”
- “帮我找一个意外连接。”
- “下一步我该研究什么？”

输出要求：

- 保留模型创造力；
- 每个启发项说明关联到哪些 wiki 节点；
- 标注它是 `connection`、`hypothesis`、`question`、`action` 还是 `missingEvidence`；
- 不把灵感伪装成已有知识。

## 9. Query Output 设计

### 9.1 通用 JSON

```json
{
  "ok": true,
  "mode": "expand",
  "question": "...",
  "answer": "...",
  "board": {
    "seedNodes": [],
    "evidenceNodes": [],
    "relatedNodes": [],
    "counterNodes": [],
    "sourceExcerpts": []
  },
  "fromWiki": [
    {
      "claim": "...",
      "nodeId": "...",
      "filePath": "...",
      "chunkRefs": [1]
    }
  ],
  "modelSynthesis": [
    {
      "text": "...",
      "basedOn": ["node-a", "node-b"],
      "confidence": "medium"
    }
  ],
  "missingEvidence": [
    {
      "question": "...",
      "reason": "No wiki node covers this condition."
    }
  ],
  "suggestedNextActions": [],
  "usage": {}
}
```

### 9.2 关键原则

回答可以自由，但输出必须可分解：

```text
fromWiki       来自 wiki 的内容
modelSynthesis 模型基于 wiki 的综合
missingEvidence wiki 暂无依据的部分
nextActions    下一步可做什么
```

这比“限制 LLM 只能说证据内事实”更符合产品哲学。LLM 可以发散，但用户和 agent 能看清发散从哪里开始。

## 10. CLI 设计

### 10.1 Ingest

保持：

```bash
llmwiki ingest <path> --auto --policy conservative --json
```

新增推荐：

```bash
llmwiki ingest <path> --auto --policy conservative --json --audit
```

`--audit` 表示 ingest 后自动运行结构 audit。后续可支持：

```bash
llmwiki ingest <path> --auto --policy conservative --json --audit semantic
```

### 10.2 Plan

保持：

```bash
llmwiki plan <path> --json
```

v6.0 `plan` 应返回：

```json
{
  "ok": true,
  "path": "...",
  "format": "pdf",
  "willWriteChase": true,
  "estimatedChunks": 4,
  "recommendedCommand": "llmwiki ingest ...",
  "risks": []
}
```

注意：`plan` 不判断“值不值得入库”，只判断“能不能处理、会怎么处理”。

### 10.3 Audit

```bash
llmwiki audit --json
llmwiki audit --semantic --json
llmwiki audit --semantic --source <sourceId> --json
llmwiki audit --semantic --node <nodeId> --json
```

### 10.4 Query

```bash
llmwiki query "question" --mode ask --json
llmwiki query "question" --mode trace --json
llmwiki query "question" --mode expand --json
llmwiki query "question" --mode compare --json
llmwiki query "question" --mode challenge --json
```

Options：

```text
--max <n>              max seed/evidence nodes
--with-source          include chase excerpts
--source <sourceId>    scope to one source
--node <nodeId>        force seed node
--tags <tags>          filter by tags
--include-legacy       include legacy pages
--json                 machine-readable output
```

### 10.5 Inspire

`inspire` 可以保留独立命令，也可以作为 `query --mode inspire`。

```bash
llmwiki inspire --seed "1/e" --json
llmwiki query "帮我基于 1/e 找新问题" --mode inspire --json
```

建议保留两个入口：

- `query --mode inspire`：用户显式问题驱动；
- `inspire`：agent 主动启发或定期回顾。

## 11. Agent Contract v6

### 11.1 标准流程

agent 必须按顺序执行：

```text
1. plan
2. ingest
3. audit
4. semantic audit
5. query / inspire
```

MVP 可允许 semantic audit 作为 warning gate，但 agent 必须把 warning 告诉用户。

### 11.2 Agent 禁止行为

agent 不得：

- 在 ingest 失败后继续 query；
- 在 audit 失败后把 wiki 当可靠来源；
- 把 `modelSynthesis` 当 `fromWiki`；
- 隐藏 `missingEvidence`；
- 自动删除 raw；
- 自动覆盖用户手工修改的 wiki；
- 把 raw 入库价值判断伪装成系统结论。

### 11.3 Agent 错误返回

失败时必须返回：

```json
{
  "ok": false,
  "stage": "audit",
  "reason": "...",
  "blockingIssues": [],
  "suggestedNextActions": []
}
```

### 11.4 Agent Helper 更新

v6.0 完成后，需要更新：

```text
helper/agent/helper.md
helper/agent/helper.zh.md
```

新增内容：

- board mode 说明；
- semantic audit gate；
- JSON output contract；
- failure handling；
- recommended automation sequence。

## 12. Prompt 设计原则

### 12.1 Compile Prompt

compile prompt 要求：

- 不新增原文没有的 central claim；
- interpretation 可以解释，但必须和 claim 区分；
- limits 必须保留原文条件；
- 每个 node 必须绑定 sourceChase/chunkRefs；
- 每个 node 必须说明适合怎样被 board 使用。

### 12.2 Semantic Audit Prompt

semantic audit prompt 要求：

- JSON-only；
- 比较 node claim 与 chase excerpt；
- 不评价 raw 是否真实；
- 只评价 wiki 是否忠实；
- 给出 aligned/stretched/unsupported；
- 给出 suggested fix。

### 12.3 Query Prompt

query prompt 不应该过度规定思考路线。

它应该说明：

- 下面是用户 wiki 中的局面；
- 你可以自由综合和推理；
- 输出时请区分 wiki 内容、模型综合、缺失依据；
- 不要把 wiki 没有的内容伪装成 wiki 已有内容。

核心不是：

```text
你必须按 exact/explore/counter 的模板回答
```

而是：

```text
这是这次摆给你的局面，请在这个局面中发挥能力
```

## 13. 实现路线

### Phase 1: v6 Spec Alignment

目标：把产品哲学和文档统一。

任务：

1. 新增 v6.0 spec；
2. 更新 README；
3. 更新 human helper；
4. 更新 agent helper；
5. 更新 user story manual；
6. 明确不做 raw 入库门控。

验收：

```text
文档中不再把入库价值判断写成系统职责
query mode 被定义为 board setup
agent contract 被明确写入
```

### Phase 2: Semantic Audit MVP

目标：增加语义审查命令。

任务：

1. 新增 `audit --semantic`;
2. 读取 node + chase chunks；
3. 调用 LLM judge；
4. 输出 semantic audit JSON；
5. 将结果写入 node frontmatter 或 audit report；
6. 添加 mock tests。

验收：

```text
npm run typecheck
npm run test
npm run build
llmwiki audit --json
llmwiki audit --semantic --json
```

### Phase 3: Query Board Builder

目标：把 query mode 实现为 context assembly。

任务：

1. 新增 `BoardMode`;
2. 新增 `buildQueryBoard`;
3. 支持 `ask/trace/expand/compare/challenge`;
4. 支持 `--node`、`--source`、`--tags`;
5. 查询输出中返回 board metadata；
6. 添加 board builder tests。

验收：

```text
query --mode ask --json
query --mode trace --json
query --mode expand --json
query --mode compare --json
query --mode challenge --json
```

### Phase 4: Inspire Board

目标：把 inspire 从随机抽样升级为结构化启发。

任务：

1. 支持 `--seed`;
2. 召回 weakly related nodes；
3. 纳入 questions/insights/counters/anchors；
4. 输出 `connections/hypotheses/questions/actions/missingEvidence`;
5. 标注每个启发项的 wiki anchors。

验收：

```text
llmwiki inspire --seed "..." --json
query --mode inspire "..." --json
```

### Phase 5: Agent Contract Tests

目标：保证外部 agent 可以稳定调用。

任务：

1. 为核心命令固定 JSON schema；
2. ingest failure 测试；
3. audit failure 测试；
4. semantic audit warning 测试；
5. query board output 测试；
6. e2e: pdf/md/tex 三格式。

验收：

```text
PDF e2e passes
MD e2e passes
TeX folder e2e passes
agent helper examples all run
```

### Phase 6: Graph Window

目标：不实现 graph 产品，但让 graph 未来可生长。

任务：

1. 稳定 `index.json`;
2. 增加 `claimHash`;
3. 增加 `propRefs`;
4. 增加 `boardRoles`;
5. 增加 `related` 生成规则；
6. 记录 node-to-source 和 node-to-node 的轻量关系。

验收：

```text
未来 graph importer 可以只读 wiki/index.json + wiki nodes + chase，不重新调用 LLM
```

## 14. 测试设计

### 14.1 Unit Tests

- v6 frontmatter parser；
- chase chunk resolver；
- semantic audit prompt builder；
- semantic audit JSON parser；
- board builder；
- mode alias；
- query output parser。

### 14.2 Integration Tests

- PDF ingest -> chase -> wiki -> audit；
- MD ingest -> chase -> wiki -> audit；
- TeX folder ingest -> chase -> wiki -> audit；
- semantic audit mock pass；
- semantic audit mock warning；
- query board ask；
- query board trace；
- query board challenge。

### 14.3 End-to-End Tests

标准 e2e：

```text
clear wiki
ingest PDF
audit
semantic audit
query ask
query trace
query expand
inspire
```

三格式 e2e：

```text
PDF: raw/original/pdf/e 的基本画像.pdf
MD: raw/original/md/<sample>.md
TeX: raw/original/tex/<paper-project-folder>/
```

### 14.4 Manual Review

每次大版本至少人工抽查：

- 3 个 concept nodes；
- 1 个 method node；
- 1 个 equation node；
- 1 个 counter node；
- 1 次 trace query；
- 1 次 inspire query。

人工审查重点：

- 是否有明显语义漂移；
- evidence 是否支撑 claim；
- limits 是否保留；
- inspire 是否回到 wiki 结构；
- query 是否把推理和 wiki 混淆。

## 15. 质量指标

### 15.1 Wiki Quality

```text
structureAuditCoverage >= 1.0
semanticAuditPassed >= 0.85
unsupportedClaims == 0
invalidChunkRefs == 0
missingEvidenceSections == 0
```

### 15.2 Agent Usability

```text
all core commands support --json
machine-readable failure for every stage
no query after blocking audit failure
stable JSON schemas in tests
```

### 15.3 Query Board Quality

```text
ask includes relevant claim/evidence
trace includes chase excerpts
expand includes related nodes
compare includes multiple node groups
challenge includes limits/counter/gaps
inspire includes weak links/questions/actions
```

### 15.4 Product Fit

定性标准：

- 用户不需要填写额外入库表单；
- agent 可以独立跑完基础流程；
- LLM 回答明显受到 wiki 结构影响；
- 多轮对话不容易脱离用户已有知识结构；
- 用户能看出哪些是 wiki，哪些是模型新推理。

## 16. 与 v5 的区别

| 维度 | v5 | v6 |
| --- | --- | --- |
| 产品定位 | agent-callable second-brain CLI | agent-first knowledge board/compiler |
| raw 入口 | 格式结构稳定 | 明确不做价值门控 |
| audit | 结构审查为主 | 增加语义忠实度审查 |
| query | 搜索上下文 + 回答 | board setup + 自由推理 + 输出分层 |
| inspire | 基础节点抽样 | wiki 局面驱动的结构化启发 |
| agent contract | 推荐流程 | 硬协议 |
| graph | 预留窗口 | 通过 schema/manifest 更明确预留 |

## 17. 风险与取舍

### 17.1 Semantic Audit 成本

LLM judge 会增加 API 成本。

取舍：

- 默认结构 audit 仍可快速运行；
- semantic audit 可按 source/node 范围运行；
- 后续加入规则预筛，减少 LLM judge 调用。

### 17.2 Query Board 复杂度

board setup 可能让 query 代码复杂。

取舍：

- 先实现 deterministic board builder；
- 不急于上 graph；
- 不急于上 embedding；
- 用文件系统和 frontmatter 先撑住。

### 17.3 Inspire 容易重新变成自由联想

inspire 最容易漂移。

取舍：

- 不限制模型创造力；
- 但每个启发项必须带 wiki anchors；
- 缺少依据的启发必须标成 hypothesis 或 missingEvidence。

### 17.4 过度结构化会压制 LLM

如果 prompt 过硬，会把 LLM 变成模板填空机。

取舍：

- mode 只做上下文装配；
- prompt 只要求输出边界清晰；
- 不规定推理路线。

## 18. 推荐下一步

建议按以下顺序推进：

1. 固化 v6 文档和 helper；
2. 实现 `audit --semantic --json` MVP；
3. 实现 `query --mode ask|trace|expand|compare|challenge`;
4. 重构 `inspire` 为 board-driven；
5. 补 PDF/MD/TeX 三格式 e2e；
6. 更新 agent helper，使外部 agent 可按 v6 contract 自动化使用。

第一优先级应该是 Semantic Audit。原因：如果 wiki 本身不可靠，后面的 board setup 只会把不可靠结构更高效地交给 LLM。

第二优先级是 Query Board。原因：这是 v6 产品哲学的核心落地：不是约束 LLM 怎么下棋，而是把用户自己的知识局面摆给它。

