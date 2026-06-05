# LiteWikiagent v6.0 详细优化计划书

Date: 2026-06-04

## 1. 计划目标

本计划基于当前代码实现和 `spec/lite_llmwiki_v6.0.md`，目标是把 LiteWikiagent 从 v5 的“agent-callable second-brain CLI”升级为 v6 的“agent-first knowledge board/compiler”。

v6.0 的核心不是限制 LLM 怎么思考，而是让系统稳定完成三件事：

```text
1. 忠实编译：raw/chase -> wiki
2. 语义审查：wiki claim 是否被 chase/source 支持
3. 摆出局面：根据用户问题把合适的 wiki board 交给 LLM
```

v6.0 明确不做 raw 入库价值门控。用户把材料放进 `raw/original/` 就是入库意图，系统只负责把材料可靠地编译、审查、组织给 agent 使用。

## 2. 当前代码基线

### 2.1 已有 CLI

入口文件：

```text
lite-llmwiki/src/cli/index.ts
```

当前注册命令：

```text
ingest
status
query
node
chat
search
audit
inspire
plan
```

当前 agent 可用主流程：

```bash
node dist/cli.js plan <path> --json
node dist/cli.js ingest <path> --auto --policy conservative --json
node dist/cli.js audit --json
node dist/cli.js search "query" --json
node dist/cli.js query "question" --json
node dist/cli.js inspire --json
```

### 2.2 已有存储层

主要文件：

```text
lite-llmwiki/src/knowledge/store.ts
lite-llmwiki/src/knowledge/render.ts
```

当前能力：

- 保存 `raw/original/<format>/`;
- 保存 `raw/chase/*.md`;
- 保存 v5 wiki node；
- 重建 `wiki/index.md` 和 `wiki/index.json`;
- 追加 `wiki/log.md`;
- TeX project folder 会作为 source unit 被保存。

当前问题：

- `index.json` 字段仍偏 v5，缺少 v6 board/audit/graph-ready 字段；
- render 层只输出 v5 sections，没有 `Audit Notes` 和 `Board Use`;
- v6 字段还没有类型定义；
- frontmatter 序列化支持简单值和数组，但复杂字段暂不处理。

### 2.3 已有审查层

主要文件：

```text
lite-llmwiki/src/knowledge/audit.ts
lite-llmwiki/src/cli/commands/audit.ts
```

当前 `audit` 是结构审查，检查：

- `nodeId`;
- `kind`;
- `sourceChase`;
- `chunkRefs`;
- chase 文件是否存在；
- chunkRef 是否能在 chase 中找到；
- `Evidence` section；
- `Claim` section；
- legacy page warning。

当前问题：

- 不能判断 claim 是否真的被 evidence 支持；
- 不能判断 interpretation 是否被误写成事实；
- 不能判断是否遗漏重要 limits；
- 不能判断 evidence 与 claim 只是主题相似还是直接支撑；
- 无 `--semantic`。

### 2.4 已有查询层

主要文件：

```text
lite-llmwiki/src/query/search.ts
lite-llmwiki/src/query/engine.ts
lite-llmwiki/src/cli/commands/query.ts
```

当前能力：

- `searchWiki` 做本地关键词检索；
- `queryKnowledge` 取 top nodes，组装 Claim/Evidence context；
- 调用 DeepSeek 生成回答；
- 从回答文本中抽取 `inferences` 和 `missingEvidence`;
- CLI 支持 `--json`、`--max`、`--include-legacy`。

当前问题：

- query prompt 仍偏“事实回答只使用 Claim/Evidence”，不符合 v6 “board setup + 自由推理 + 输出分层”的哲学；
- 没有 `--mode ask|trace|expand|compare|challenge`;
- 没有 board metadata 输出；
- 没有 source/chase excerpt 装配；
- 没有按 node/source/tags 强制 seed；
- `SearchMatch` 缺少 `limits`、`interpretation`、`sourceChase`、`chunkRefs`、`related`、`auditStatus` 等字段。

### 2.5 已有启发层

主要文件：

```text
lite-llmwiki/src/query/inspire.ts
lite-llmwiki/src/cli/commands/inspire.ts
```

当前能力：

- 从 wiki 中随机选一个节点；
- 可按 `kind` 和 `tags` 过滤；
- 不依赖 LLM；
- JSON 输出基础页面信息。

当前问题：

- 这是 sampling，不是 v6 的 board-driven inspire；
- 没有 seed query；
- 没有 weak links、questions、counters、anchors；
- 没有生成 `connections/hypotheses/questions/actions/missingEvidence`;
- 没有明确标注每个启发项关联的 wiki anchors。

### 2.6 当前测试

现有测试文件：

```text
lite-llmwiki/tests/knowledge-store.test.ts
lite-llmwiki/tests/query-engine.test.ts
lite-llmwiki/tests/golden-e2e.test.ts
```

当前覆盖：

- raw/original + raw/chase 存储；
- TeX project folder 存储；
- v5 node render + audit；
- legacy wiki audit warning；
- local search；
- basic inspire；
- query annotation extraction。

需要补充：

- semantic audit；
- v6 frontmatter；
- shared parser；
- chase chunk resolver；
- query board builder；
- query mode CLI；
- inspire board；
- agent contract e2e。

## 3. v6.0 优化原则

### 3.1 不做 raw 入库限制

不新增：

- 入库价值评分；
- 入库理由强制填写；
- 自动拒绝入库；
- 材料适用性判断；
- 用户动机审查。

`plan` 只判断能否处理文件和会如何处理，不判断材料值不值得进入知识库。

### 3.2 先审查 wiki，再让 agent 使用

v6 的质量闸门在 wiki 产物，而不是 raw 入口：

```text
structure audit: wiki 是否可追溯
semantic audit: wiki 是否忠实表达 source/chase
agent contract: audit 失败不能继续当可靠知识使用
```

### 3.3 Query mode 是 board setup

`query --mode` 不定义 LLM 的思考路线，只定义上下文装配策略。

```text
ask       普通问答局面
trace     来源追溯局面
expand    扩展理解局面
compare   比较局面
challenge 挑战与审查局面
inspire   启发局面
```

输出必须区分：

```text
fromWiki
modelSynthesis
missingEvidence
suggestedNextActions
```

### 3.4 Graph 只留窗口

v6 不实现完整 graph 产品，但要让未来 graph 可以从文件系统自然生长：

- `claimHash`;
- `propRefs`;
- `boardRoles`;
- `related`;
- `sourceIds`;
- `sourceChase`;
- `chunkRefs`;
- 稳定 `index.json`。

## 4. 总体实施顺序

推荐顺序：

```text
Phase 0: 文档与现状对齐
Phase 1: 共享解析层与 v6 schema 基础
Phase 2: Semantic Audit MVP
Phase 3: Query Board Builder
Phase 4: Query CLI 与输出协议
Phase 5: Inspire Board
Phase 6: Agent Contract 与三格式 e2e
Phase 7: Graph-ready manifest
Phase 8: 文档与发布整理
```

最重要的工程顺序：

```text
先 parser/schema
再 semantic audit
再 board builder
最后 inspire/graph window
```

原因：semantic audit 和 board setup 都依赖稳定解析 wiki node、section、frontmatter、chase chunk。

## 5. Phase 0: 文档与基线确认

### 5.1 目标

把 v6 产品理解固定下来，避免后续实现偏移。

### 5.2 任务

1. 保留 `spec/lite_llmwiki_v6.0.md` 作为 v6 产品设计源。
2. 新增本计划书。
3. 后续更新：
   - `lite-llmwiki/README.md`;
   - `helper/human/helper.md`;
   - `helper/human/helper.zh.md`;
   - `helper/agent/helper.md`;
   - `helper/agent/helper.zh.md`;
   - `helper/human/user_story_manual.md`。
4. 明确 `.codebase-memory` 当前删除状态不属于 v6 产品改造，单独处理。

### 5.3 验收

文档中必须明确：

- 用户负责选材；
- 系统不做 raw 入库价值判断；
- semantic audit 是 v6 第一质量闸门；
- query mode 是 board setup；
- agent contract 是硬协议。

## 6. Phase 1: 共享解析层与 v6 schema 基础

### 6.1 背景

当前以下模块都各自实现了 frontmatter/body parser：

```text
knowledge/audit.ts
query/search.ts
query/inspire.ts
knowledge/store.ts
```

这会导致 v6 字段扩展后出现解析不一致。

### 6.2 目标

建立共享 wiki parser 和 chase resolver，作为 v6 后续能力的基础。

### 6.3 新增/修改文件

新增：

```text
lite-llmwiki/src/knowledge/wiki-parser.ts
lite-llmwiki/src/knowledge/chase.ts
```

修改：

```text
lite-llmwiki/src/types.ts
lite-llmwiki/src/knowledge/audit.ts
lite-llmwiki/src/query/search.ts
lite-llmwiki/src/query/inspire.ts
lite-llmwiki/src/knowledge/store.ts
lite-llmwiki/src/knowledge/render.ts
```

新增测试：

```text
lite-llmwiki/tests/wiki-parser.test.ts
lite-llmwiki/tests/chase-resolver.test.ts
lite-llmwiki/tests/v6-frontmatter.test.ts
```

### 6.4 类型扩展

在 `types.ts` 中扩展：

```typescript
export type AuditStatus = "pending" | "passed" | "warning" | "failed";
export type ClaimType =
  | "source_claim"
  | "interpretation"
  | "application"
  | "analogy"
  | "question"
  | "counter";
export type InferenceLevel = "none" | "light" | "medium" | "strong";
export type BoardRole =
  | "evidence"
  | "concept"
  | "method"
  | "case"
  | "limit"
  | "counter"
  | "question"
  | "anchor"
  | "bridge";
```

扩展 `WikiFrontmatter`：

```typescript
auditStatus?: AuditStatus;
auditScore?: number;
claimType?: ClaimType;
inferenceLevel?: InferenceLevel;
propRefs?: string[];
claimHash?: string;
boardRoles?: BoardRole[];
```

### 6.5 Parser 输出

`wiki-parser.ts` 输出统一结构：

```typescript
interface ParsedWikiNode {
  nodeId: string;
  kind: WikiKind;
  title: string;
  filePath: string;
  frontmatter: WikiFrontmatter;
  sections: {
    claim: string;
    evidence: string[];
    interpretation: string;
    useFor: string[];
    limits: string[];
    links: string[];
    auditNotes: string;
    boardUse: string[];
  };
  fullText: string;
  isLegacy: boolean;
}
```

### 6.6 Chase Resolver

`chase.ts` 提供：

```typescript
resolveChasePath(config, sourceChase): string | null
readChaseChunks(config, sourceChase): ChaseChunk[]
selectChaseChunks(config, sourceChase, chunkRefs): ChaseChunk[]
collectChunkIndices(chaseContent): Set<number>
```

### 6.7 兼容策略

- v5 node 不要求必须有 v6 字段；
- v6 字段缺失时给默认值；
- legacy page 仍可 search/inspire，但 audit 标 warning；
- render 输出 v6 字段时跳过空值。

### 6.8 验收

命令：

```bash
cd lite-llmwiki
npm run typecheck
npm run test
npm run build
```

测试要求：

- 原有 26 个测试继续通过；
- parser 能解析 v5 node；
- parser 能解析 v6 node；
- chase resolver 能按 `sourceChase + chunkRefs` 取回 excerpt；
- audit/search/inspire 迁移到共享 parser 后行为不退化。

## 7. Phase 2: Semantic Audit MVP

### 7.1 目标

在结构 audit 之外新增语义审查，判断 wiki node 是否忠实于 chase。

### 7.2 新增/修改文件

新增：

```text
lite-llmwiki/src/knowledge/semantic-audit.ts
lite-llmwiki/src/knowledge/semantic-audit-prompt.ts
```

修改：

```text
lite-llmwiki/src/cli/commands/audit.ts
lite-llmwiki/src/types.ts
```

新增测试：

```text
lite-llmwiki/tests/semantic-audit.test.ts
lite-llmwiki/tests/semantic-audit-prompt.test.ts
```

### 7.3 CLI 设计

扩展：

```bash
llmwiki audit --json
llmwiki audit --semantic --json
llmwiki audit --semantic --source <sourceId> --json
llmwiki audit --semantic --node <nodeId> --json
```

MVP 中：

- `audit --json` 保持结构 audit；
- `audit --semantic --json` 调 LLM judge；
- 没有 API key 时返回 machine-readable error；
- 不自动改 wiki 文件。

### 7.4 Semantic Audit 输入

每个 node 输入：

- frontmatter；
- `Claim`;
- `Evidence`;
- `Interpretation`;
- `Limits`;
- `sourceChase`;
- `chunkRefs`;
- chase excerpt。

### 7.5 Semantic Audit 输出

```typescript
interface SemanticAuditResult {
  ok: boolean;
  summary: {
    nodes: number;
    passed: number;
    warning: number;
    failed: number;
    averageScore: number;
  };
  issues: SemanticAuditIssue[];
}
```

单 issue：

```typescript
interface SemanticAuditIssue {
  nodeId: string;
  filePath: string;
  severity: "warning" | "error";
  dimension: "support" | "addition" | "inference" | "limits" | "citation";
  claim: string;
  evidenceExcerpt: string;
  reason: string;
  suggestedFix?: string;
}
```

### 7.6 LLM Judge 结果

每个 node 的 judge 结果：

```json
{
  "nodeId": "...",
  "verdict": "passed",
  "score": 0.92,
  "support": "aligned",
  "addition": "none",
  "inference": "ok",
  "limits": "ok",
  "citation": "ok",
  "issues": []
}
```

### 7.7 错误策略

- LLM JSON parse 失败：该 node 记为 warning，返回 raw response 摘要；
- chase 缺失：直接 error，不调用 semantic judge；
- chunkRefs 缺失：直接 error，不调用 semantic judge；
- API key 缺失：整体 `ok=false`，`stage=semantic-audit`;
- 单个 node 失败不影响其他 node 审查。

### 7.8 是否写回 node

MVP 不直接覆盖 wiki。

第二步可新增：

```bash
llmwiki audit --semantic --write-status --json
```

写入：

```yaml
auditStatus: passed
auditScore: 0.92
```

默认不写，避免自动修改用户可能手工编辑过的 wiki。

### 7.9 验收

结构验收：

```bash
npm run typecheck
npm run test
npm run build
```

功能验收：

```bash
node dist/cli.js audit --json
node dist/cli.js audit --semantic --json
node dist/cli.js audit --semantic --source <sourceId> --json
node dist/cli.js audit --semantic --node <nodeId> --json
```

质量验收：

- 能识别 supported claim；
- 能识别 unsupported claim；
- 能识别 interpretation 被写成事实；
- 能识别 limits 缺失；
- 输出 JSON 稳定。

## 8. Phase 3: Query Board Builder

### 8.1 目标

把 query mode 实现为 board setup，而不是 prompt template 限制。

### 8.2 新增/修改文件

新增：

```text
lite-llmwiki/src/query/board.ts
lite-llmwiki/src/query/board-types.ts
```

修改：

```text
lite-llmwiki/src/query/search.ts
lite-llmwiki/src/query/engine.ts
lite-llmwiki/src/cli/commands/query.ts
```

新增测试：

```text
lite-llmwiki/tests/query-board.test.ts
lite-llmwiki/tests/query-modes.test.ts
```

### 8.3 Board Mode

新增类型：

```typescript
export type BoardMode =
  | "ask"
  | "trace"
  | "expand"
  | "compare"
  | "challenge"
  | "inspire";
```

兼容 alias：

```text
exact -> trace
explore -> expand
counter -> challenge
```

### 8.4 Query Board 类型

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
}
```

### 8.5 BoardNode 类型

```typescript
interface BoardNode {
  nodeId: string;
  kind: WikiKind;
  title: string;
  filePath: string;
  claim: string;
  evidence: string[];
  interpretation: string;
  limits: string[];
  tags: string[];
  sourceIds: string[];
  sourceChase: string[];
  chunkRefs: number[];
  auditStatus?: AuditStatus;
  auditScore?: number;
  boardRoles: BoardRole[];
  score: number;
}
```

### 8.6 Mode 装配规则

`ask`：

- top relevant nodes；
- claim/evidence/limits；
- 少量 related；
- 默认不带完整 chase excerpt，避免 prompt 过大。

`trace`：

- top relevant nodes；
- full evidence；
- referenced chase excerpts；
- sourceId/chunkRefs；
- 用于追溯来源与审查偏移。

`expand`：

- seed nodes；
- related nodes；
- methods/cases/equations；
- anchors/questions；
- light limits；
- 适合让 LLM 在 wiki 结构上自由扩展。

`compare`：

- 至少两组 seed nodes；
- 共享 tags；
- possible bridge nodes；
- each side claim/evidence/limits；
- 若无法形成两组，则返回 `gaps`。

`challenge`：

- target claim node；
- limits；
- counters；
- weak evidence；
- conflicting/adjacent claims；
- missing evidence。

`inspire`：

- seed node/query；
- insights/questions/counters/anchors；
- weakly related nodes；
- recent nodes；
- bridge candidates。

### 8.7 检索改造

`searchWiki` 扩展为更完整的结果：

```typescript
SearchMatchV6 {
  ...SearchMatch;
  interpretation: string;
  limits: string[];
  useFor: string[];
  sourceIds: string[];
  sourceChase: string[];
  chunkRefs: number[];
  related: string[];
  tags: string[];
  auditStatus?: AuditStatus;
  auditScore?: number;
}
```

短期仍使用 lexical score，不引入 embedding。

### 8.8 验收

测试：

- `ask` board 包含 seed/evidence nodes；
- `trace` board 包含 chase excerpts；
- `expand` board 包含 related/questions/anchors；
- `compare` board 能形成多组；
- `challenge` board 包含 limits/counters；
- alias 正确映射。

命令：

```bash
npm run typecheck
npm run test
npm run build
```

## 9. Phase 4: Query CLI 与输出协议

### 9.1 目标

让外部 agent 可以用 `query --mode` 获取稳定 JSON，并清楚区分 wiki、模型综合和缺失依据。

### 9.2 CLI 设计

扩展：

```bash
llmwiki query "question" --mode ask --json
llmwiki query "question" --mode trace --json
llmwiki query "question" --mode expand --json
llmwiki query "question" --mode compare --json
llmwiki query "question" --mode challenge --json
```

新增 options：

```text
--mode <mode>
--node <nodeId>
--source <sourceId>
--tags <tags>
--with-source
--max <n>
--include-legacy
--json
```

### 9.3 Query Engine 改造

`queryKnowledge` 改造输入：

```typescript
interface QueryOptions {
  question: string;
  config: AppConfig;
  mode?: BoardMode;
  maxNodes?: number;
  includeLegacy?: boolean;
  nodeId?: string;
  sourceId?: string;
  tags?: string[];
  withSource?: boolean;
}
```

### 9.4 Query Result v6

```typescript
interface QueryResultV6 {
  ok: boolean;
  mode: BoardMode;
  question: string;
  answer: string;
  board: QueryBoardSummary;
  fromWiki: WikiClaimRef[];
  modelSynthesis: ModelSynthesis[];
  missingEvidence: MissingEvidence[];
  suggestedNextActions: string[];
  usage: Usage | null;
}
```

兼容层：

- human output 可以保持自然语言；
- JSON 输出建议新增 v6 字段；
- 老字段 `sources`、`inferences` 可短期保留，避免破坏 helper 里的当前用法。

### 9.5 Prompt 改造

现有 prompt 偏严格：

```text
事实回答只使用 Claim / Evidence
```

v6 prompt 要改成：

```text
下面是用户 wiki 为本次问题摆出的局面。
你可以自由综合、判断、推理和发散。
但输出必须区分：
- 来自 wiki 的内容
- 基于 wiki 的模型综合
- wiki 暂无依据的部分
不要把模型综合伪装成 wiki 已有内容。
```

### 9.6 JSON 解析策略

MVP 建议让 LLM 直接输出 JSON：

```json
{
  "answer": "...",
  "fromWiki": [],
  "modelSynthesis": [],
  "missingEvidence": [],
  "suggestedNextActions": []
}
```

如果 JSON parse 失败：

- `answer` 使用原始文本；
- `fromWiki` 从 board seed nodes 填充；
- `modelSynthesis` 和 `missingEvidence` 用现有 `extractAnnotations` fallback；
- 返回 `warnings`。

### 9.7 验收

功能命令：

```bash
node dist/cli.js query "..." --mode ask --json
node dist/cli.js query "..." --mode trace --with-source --json
node dist/cli.js query "..." --mode expand --json
node dist/cli.js query "..." --mode compare --json
node dist/cli.js query "..." --mode challenge --json
```

测试：

- 无匹配 node 时返回 `ok=true` 但有 `missingEvidence`;
- API key 缺失时返回 `ok=false`;
- JSON shape 稳定；
- board metadata 在 JSON 中存在；
- 不把 `modelSynthesis` 混入 `fromWiki`。

## 10. Phase 5: Inspire Board

### 10.1 目标

把 `inspire` 从随机抽样升级为基于 wiki 局面的结构化启发。

### 10.2 新增/修改文件

新增：

```text
lite-llmwiki/src/query/inspire-board.ts
```

修改：

```text
lite-llmwiki/src/query/inspire.ts
lite-llmwiki/src/cli/commands/inspire.ts
lite-llmwiki/src/query/engine.ts
```

新增测试：

```text
lite-llmwiki/tests/inspire-board.test.ts
```

### 10.3 CLI

保留：

```bash
llmwiki inspire --json
llmwiki inspire --kind concept --tags math --json
```

新增：

```bash
llmwiki inspire --seed "1/e" --json
llmwiki inspire --node <nodeId> --json
llmwiki inspire --source <sourceId> --json
```

并支持：

```bash
llmwiki query "帮我基于 1/e 找新问题" --mode inspire --json
```

### 10.4 输出

```json
{
  "ok": true,
  "mode": "inspire",
  "seed": {},
  "connections": [],
  "hypotheses": [],
  "questions": [],
  "actions": [],
  "missingEvidence": [],
  "anchors": []
}
```

### 10.5 启发项规则

每个启发项必须带：

- `type`;
- `text`;
- `basedOn` nodeIds；
- `confidence`;
- `evidenceBoundary`。

示例：

```json
{
  "type": "hypothesis",
  "text": "...",
  "basedOn": ["node-a", "node-b"],
  "confidence": "medium",
  "evidenceBoundary": "This is model synthesis based on wiki nodes, not a source claim."
}
```

### 10.6 验收

- 无 API key 时仍能做 local seed preview；
- 有 API key 时能生成结构化启发；
- 每个启发项都能回到 wiki anchors；
- 不把 inspiration 当成 source-backed claim；
- `query --mode inspire` 和 `inspire` 输出结构兼容。

## 11. Phase 6: Agent Contract 与三格式 e2e

### 11.1 目标

让 Reasonix/Codex/Claude Code/opencode 等 agent 可以稳定自动化使用。

### 11.2 Agent 标准流程

```text
1. plan <path> --json
2. ingest <path> --auto --policy conservative --json
3. audit --json
4. audit --semantic --json
5. query/inspire
```

### 11.3 CLI 错误协议

所有核心命令 JSON failure 必须包含：

```json
{
  "ok": false,
  "stage": "...",
  "error": "...",
  "blockingIssues": [],
  "suggestedNextActions": []
}
```

核心命令：

```text
plan
ingest
audit
query
search
inspire
```

### 11.4 三格式 e2e

测试目标：

```text
PDF -> chase -> wiki -> audit -> semantic audit mock -> query board
MD  -> chase -> wiki -> audit -> semantic audit mock -> query board
TeX folder -> chase -> wiki -> audit -> semantic audit mock -> query board
```

现有 `golden-e2e.test.ts` 已经有三格式 fixture，可在其基础上增加 v6 board 和 semantic mock。

### 11.5 Agent Helper 更新

更新：

```text
helper/agent/helper.md
helper/agent/helper.zh.md
```

必须写入：

- 不做 raw 入库价值判断；
- agent 必须先 audit；
- semantic audit warning 如何处理；
- query mode 是 board setup；
- v6 JSON output shape；
- 失败时不能继续编答案。

### 11.6 验收

```bash
cd lite-llmwiki
npm run typecheck
npm run test
npm run build
```

手动 e2e：

```bash
node dist/cli.js plan ../raw/original/pdf/e\ 的基本画像.pdf --json
node dist/cli.js ingest ../raw/original/pdf/e\ 的基本画像.pdf --auto --policy conservative --json
node dist/cli.js audit --json
node dist/cli.js audit --semantic --json
node dist/cli.js query "为什么 1/e 可以作为失败概率基线？" --mode ask --json
node dist/cli.js query "这个判断从哪来？" --mode trace --with-source --json
node dist/cli.js inspire --seed "1/e" --json
```

## 12. Phase 7: Graph-ready Manifest

### 12.1 目标

不实现 graph 产品，但让未来 graph 可以只读现有文件构建。

### 12.2 修改文件

```text
lite-llmwiki/src/knowledge/store.ts
lite-llmwiki/src/knowledge/render.ts
lite-llmwiki/src/types.ts
```

### 12.3 index.json v6 字段

扩展 `IndexEntry`：

```typescript
type IndexEntryV6 = {
  nodeId: string;
  kind: string;
  title: string;
  filePath: string;
  sourceIds: string[];
  sourceChase: string[];
  chunkRefs: number[];
  tags: string[];
  related: string[];
  confidence: number;
  status: string;
  auditStatus?: string;
  auditScore?: number;
  claimType?: string;
  inferenceLevel?: string;
  propRefs: string[];
  claimHash?: string;
  boardRoles: string[];
  updatedAt: string;
};
```

### 12.4 claimHash

短期实现：

```text
normalized claim -> sha256 -> first 16 chars
```

用途：

- 检测重复 node；
- 未来 graph node merge；
- 未来 cross-source claim comparison。

### 12.5 related 规则

短期基于：

- shared tags；
- shared sourceIds；
- lexical overlap；
- explicit `related` frontmatter。

不实现：

- embedding；
- graph traversal；
- contradiction edge；
- graph UI。

### 12.6 验收

- `wiki/index.json` 包含 v6 字段；
- v5 node 字段缺失时有默认值；
- index rebuild 不破坏现有 markdown index；
- future graph importer 可以不调用 LLM 读取 manifest。

## 13. Phase 8: 文档与发布整理

### 13.1 README

更新：

```text
lite-llmwiki/README.md
```

写清：

- v6 定位；
- raw/chase/wiki 流程；
- semantic audit；
- query board modes；
- agent contract；
- 不做 raw 入库门控；
- graph window。

### 13.2 Human Helper

更新：

```text
helper/human/helper.md
helper/human/helper.zh.md
helper/human/user_story_manual.md
```

重点：

- 用户只需要把材料放进 raw；
- 不需要填写价值判断；
- 如何让 agent 编译；
- 如何看 audit；
- 如何提问；
- 如何理解 fromWiki/modelSynthesis/missingEvidence。

### 13.3 Agent Helper

更新：

```text
helper/agent/helper.md
helper/agent/helper.zh.md
```

重点：

- 命令协议；
- JSON shape；
- failure handling；
- query board mode；
- semantic audit gate；
- e2e recipe。

### 13.4 Spec Process

新增过程记录：

```text
spec_process/2026-06-04-v6-process-review.md
```

记录：

- 完成项；
- 偏移项；
- 测试结果；
- e2e 结果；
- 后续计划。

## 14. 详细任务清单

### P0 必须完成

- [ ] 抽出 `wiki-parser.ts`;
- [ ] 抽出 `chase.ts`;
- [ ] 扩展 v6 frontmatter 类型；
- [ ] 实现 `audit --semantic --json`;
- [ ] 增加 semantic audit mock tests；
- [ ] 实现 `QueryBoard`;
- [ ] 实现 `query --mode ask|trace|expand|compare|challenge`;
- [ ] JSON 输出新增 `fromWiki/modelSynthesis/missingEvidence`;
- [ ] 保持现有测试通过。

### P1 应该完成

- [ ] `query --node`;
- [ ] `query --source`;
- [ ] `query --tags`;
- [ ] `query --with-source`;
- [ ] `inspire --seed`;
- [ ] `query --mode inspire`;
- [ ] agent failure JSON 统一；
- [ ] README/helper 更新；
- [ ] 三格式 e2e 扩展。

### P2 可以延后

- [ ] semantic audit 写回 frontmatter；
- [ ] `audit --semantic --fix-draft`;
- [ ] claimHash 去重提示；
- [ ] related 自动生成；
- [ ] graph importer prototype；
- [ ] embedding/vector search。

## 15. 风险与控制

### 15.1 Parser 重构风险

风险：重复 parser 抽离可能影响 audit/search/inspire 现有行为。

控制：

- 先写 parser golden tests；
- 再逐模块迁移；
- 每迁移一个模块跑一次 test；
- 保留旧字段兼容。

### 15.2 Semantic Audit 成本

风险：每个 node 调 LLM judge，成本和耗时增加。

控制：

- 支持 `--node` 和 `--source`;
- 默认结构 audit 不调 LLM；
- semantic audit 可按需运行；
- 后续加规则预筛。

### 15.3 Query Board 过度复杂

风险：board setup 代码复杂，且早期没有 graph/embedding 支撑。

控制：

- 第一版 deterministic lexical board；
- 不引入 graph；
- 不引入 embedding；
- board 输出透明化，便于 debug。

### 15.4 Prompt 重新变成模板化约束

风险：实现时把 mode 写成固定问答模板，压制 LLM 能力。

控制：

- mode 只影响 context assembly；
- prompt 只要求输出边界；
- 不规定推理步骤；
- 保留模型综合空间。

### 15.5 Inspire 漂移

风险：inspire 容易变成无约束联想。

控制：

- 每个 inspiration item 必须带 `basedOn`;
- 明确 `evidenceBoundary`;
- `missingEvidence` 必须显式输出；
- 不把 hypothesis 写成 source claim。

## 16. 里程碑验收

### Milestone A: v6 基础层

完成：

- shared parser；
- chase resolver；
- v6 frontmatter type；
- 原测试通过。

验收：

```bash
npm run typecheck
npm run test
npm run build
```

### Milestone B: Semantic Audit

完成：

- `audit --semantic --json`;
- semantic audit JSON；
- mock tests。

验收：

```bash
node dist/cli.js audit --json
node dist/cli.js audit --semantic --json
```

### Milestone C: Query Board

完成：

- board builder；
- `query --mode`;
- v6 query JSON。

验收：

```bash
node dist/cli.js query "..." --mode ask --json
node dist/cli.js query "..." --mode trace --with-source --json
node dist/cli.js query "..." --mode expand --json
node dist/cli.js query "..." --mode compare --json
node dist/cli.js query "..." --mode challenge --json
```

### Milestone D: Agent E2E

完成：

- PDF/MD/TeX 三格式 e2e；
- agent helper 更新；
- failure JSON 统一。

验收：

```text
plan -> ingest -> audit -> semantic audit -> query/inspire
```

可以由外部 agent 按 helper 独立执行。

### Milestone E: v6 Release Candidate

完成：

- README 更新；
- helper 更新；
- process review；
- graph-ready manifest；
- manual e2e 记录。

验收：

```bash
npm run typecheck
npm run test
npm run build
```

并完成至少一次真实材料 e2e。

## 17. 推荐第一轮开发切片

第一轮不要同时改 semantic audit 和 query board。建议先做基础层：

```text
Slice 1:
  1. 新增 wiki-parser.ts
  2. 新增 chase.ts
  3. search/audit/inspire 迁移到共享 parser
  4. 增加 v6 frontmatter type
  5. 保持所有测试通过
```

第二轮：

```text
Slice 2:
  1. semantic-audit prompt builder
  2. semantic-audit mocked judge tests
  3. audit --semantic CLI
  4. 不写回 wiki，只输出 report
```

第三轮：

```text
Slice 3:
  1. QueryBoard type
  2. buildQueryBoard ask/trace
  3. query --mode ask|trace
  4. JSON 输出 board/fromWiki/modelSynthesis/missingEvidence
```

第四轮：

```text
Slice 4:
  1. expand/compare/challenge
  2. inspire board
  3. agent helper
  4. 三格式 e2e
```

这样可以降低改造风险，并且每一轮都能独立验证。

