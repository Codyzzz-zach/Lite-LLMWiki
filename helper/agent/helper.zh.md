# LiteWikiagent 智能体助手

本指南面向自主智能体（autonomous agent），描述如何以非交互方式使用 LiteWikiagent 以及如何验证结果。

## 目标

将 LiteWikiagent 作为基于文件系统的第二大脑 CLI：

```text
raw/original -> raw/chase -> wiki -> audit/search/query/inspire
```

核心规则：在 `audit --json` 通过之前，不要信任生成的 wiki 内容。

## 仓库结构

假设仓库根目录：

```text
<repo-root>
```

包目录：

```text
<repo-root>/lite-llmwiki
```

运行时数据：

```text
raw/original/md/
raw/original/pdf/
raw/original/tex/<论文项目文件夹>/
raw/chase/
wiki/
```

重要说明：

- `raw/` 和 `wiki/` 是本地生成/运行时数据，已在 .gitignore 中。
- 使用 `raw/original/<格式>/` 作为输入层。
- 使用 `raw/chase/` 作为审计层。
- 使用 `wiki/` 作为生成的知识输出。

## 环境前提

从以下目录运行命令：

```bash
cd <repo-root>/lite-llmwiki
```

必需：

```bash
npm install
npm run build
export DEEPSEEK_API_KEY=sk-xxx
```

Node 版本要求：

```text
node >= 22
```

## 命令风格

优先使用构建后的 CLI：

```bash
node dist/cli.js <命令>
```

自动化场景使用 JSON 输出：

```bash
--json
```

默认自动化导入使用 conservative 策略：

```bash
--auto --policy conservative --json
```

## 标准自动化导入流程

### 1. 构建

```bash
npm run build
```

### 2. 导入（Ingest）

PDF：

```bash
node dist/cli.js ingest ../raw/original/pdf/e\ 的基本画像.pdf --auto --policy conservative --json
```

Markdown：

```bash
node dist/cli.js ingest ../raw/original/md/<文件>.md --auto --policy conservative --json
```

TeX 文件夹：

```bash
node dist/cli.js ingest ../raw/original/tex/<论文项目文件夹> --auto --policy conservative --json
```

预期成功输出结构：

```json
{
  "ok": true,
  "sourceId": "raw/pdf/example-id",
  "sourceChase": "/absolute/path/to/raw/chase/file.md",
  "created": ["wiki/concepts/example.md"],
  "updated": [],
  "skipped": [],
  "coverage": {
    "coveredChunks": 4,
    "totalChunks": 4,
    "uncoveredReasons": []
  }
}
```

失败输出结构可能包含：

```json
{
  "ok": false,
  "created": [],
  "updated": [],
  "skipped": [],
  "coverage": {
    "uncoveredReasons": ["Extract failed: ..."]
  }
}
```

失败时，不要继续执行 query，当作导入已成功。

### 3. 审计（Audit）

```bash
node dist/cli.js audit --json                       # 结构 audit（不调 LLM）
node dist/cli.js audit --semantic --json            # 结构 + LLM judge 语义审查
node dist/cli.js audit --source <id> --json
node dist/cli.js audit --node <nodeId> --json
```

`audit` 验证 wiki 节点是否可追溯到 chase 和 evidence。`--semantic` 增加 LLM-judge 维度：claim/evidence 是否忠实、limits 是否保留、citation 是否覆盖、inference 是否被标 inference、是否引入原文没有的强判断。

无 `DEEPSEEK_API_KEY` 时，`--semantic` 返回 v6 failure shape（spec 11.3）：

```json
{
  "ok": false,
  "stage": "semantic-audit",
  "error": "stage=semantic-audit: no LLM judge provided (missing API key or call site).",
  "blockingIssues": ["no-llm-judge"],
  "suggestedNextActions": [
    "set DEEPSEEK_API_KEY environment variable",
    "pass an llmJudge option to the CLI"
  ]
}
```

预期通过输出（结构 audit）：

```json
{
  "ok": true,
  "summary": {
    "nodes": 9,
    "verifiedNodes": 9,
    "missingEvidence": 0,
    "invalidChunkRefs": 0,
    "coverage": 1
  },
  "issues": []
}
```

`--semantic` 时还会有 `semantic` 字段，包含 `summary.{passed, warning, failed, averageScore}` 与 `issues[]`（每条含 `dimension: support|addition|inference|limits|citation`、`reason`、`suggestedFix`）。

自动化关卡要求：

```text
结构 audit:
  ok 必须为 true
  missingEvidence 必须为 0
  invalidChunkRefs 必须为 0
  coverage 应为 1（干净的端到端测试）

semantic audit:
  summary.failed 必须为 0
  issues[].severity='error' 必须为 0
```

审计失败时命令退出码为 `2`。agent 收到 `ok: false` 必须停止后续 query/inspire。

### 4. 搜索（Search）

```bash
node dist/cli.js search "查询关键词" --json --max 10
```

预期输出结构：

```json
{
  "matches": [
    {
      "nodeId": "bernoulli-all-fail-1e",
      "kind": "concept",
      "title": "伯努利试验全失败概率的 1/e 极限",
      "score": 6,
      "filePath": "wiki/concepts/bernoulli-all-fail-1e.md",
      "claim": "...",
      "evidence": ["**Source**: ..."]
    }
  ]
}
```

搜索不需要调用 LLM。

### 5. 查询（Query，v6 board 驱动）

```bash
node dist/cli.js query "问题" --mode ask --json
node dist/cli.js query "判断从哪来" --mode trace --with-source --json
node dist/cli.js query "基于此还能怎么理解" --mode expand --json
node dist/cli.js query "比较这两组观点" --mode compare --json
node dist/cli.js query "这个观点站得住吗" --mode challenge --json
```

别名：`exact→trace`、`explore→expand`、`counter→challenge`。

输出结构（v6 `QueryResultV6`）：

```json
{
  "ok": true,
  "mode": "ask",
  "question": "问题",
  "answer": "LLM 综合或 board-only 占位",
  "fromWiki": [
    { "claim": "...", "nodeId": "...", "filePath": "...", "chunkRefs": [1] }
  ],
  "modelSynthesis": [
    { "text": "...", "basedOn": ["node-a", "node-b"], "confidence": "medium" }
  ],
  "missingEvidence": [
    { "question": "...", "reason": "..." }
  ],
  "suggestedNextActions": [
    { "action": "ingest more material", "reason": "..." }
  ],
  "board": { "mode": "ask", "seedNodes": [...], "evidenceNodes": [...], "...": "..." },
  "boardSummary": { "seedCount": 1, "...": "..." },
  "usage": { "promptTokens": 707, "completionTokens": 948 }
}
```

错误（v6 agent 契约 spec 11.3）：

```json
{
  "ok": false,
  "stage": "query",
  "error": "Query failed: ...",
  "blockingIssues": [],
  "suggestedNextActions": []
}
```

智能体规则：

- `board` 已经在 deterministic 装配好（`buildQueryBoard`），不需要再调 LLM 来生成 board。
- `fromWiki` 是有 wiki 依据的内容。`modelSynthesis` 是 LLM 的综合（含 `basedOn` 锚点）。`missingEvidence` 是 wiki 暂无依据的部分。
- 除非查询输出有对应的来源节点，否则不要将其作为来源引用。
- 任何时候 `audit` 失败 → 后续 query 步骤应停止（agent 协议 spec 11.2）。

### 6. 灵感（Inspire，v6 board 驱动）

```bash
node dist/cli.js inspire --json                        # 随机抽一个
node dist/cli.js inspire --seed "1/e" --json            # 文本 seed
node dist/cli.js inspire --node <nodeId> --json        # 强制 anchor
node dist/cli.js inspire --kind concept --tags math --json
```

输出结构（v6 board-driven）：

```json
{
  "ok": true,
  "mode": "inspire",
  "seed": {
    "nodeId": "...",
    "kind": "method",
    "title": "...",
    "filePath": "...",
    "claim": "...",
    "text": "..."
  },
  "connections": [
    { "type": "connection", "text": "...", "basedOn": ["node-a", "node-b"], "confidence": "medium", "evidenceBoundary": "..." }
  ],
  "hypotheses": [],
  "questions": [],
  "actions": [],
  "missingEvidence": [],
  "anchors": []
}
```

每条启发项（connections / hypotheses / questions / actions / missingEvidence）都带：
- `basedOn`：锚定的 wiki nodeId 列表
- `confidence`：low / medium / high
- `evidenceBoundary`：显式标注 "这是综合 / 不是事实"

## 试运行（Dry Run）

在验证加载器/清洗逻辑而不写入 wiki 时使用：

```bash
node dist/cli.js ingest <路径> --auto --policy conservative --json --dry-run
```

预期行为：

- 写入 chase 文件；
- 不写入 wiki 节点；
- `created` 路径为计划输出。

## 按来源审计

验证单个来源时使用 `--source`：

```bash
node dist/cli.js audit --json --source raw_pdf_e
```

过滤器匹配 source/chase 标识符。尽可能使用导入时返回的准确 `sourceId`。

## 测试命令

提交代码变更前：

```bash
npm run typecheck
npm run test
npm run build
```

当前预期基线：

```text
26 个测试通过
类型检查通过
构建通过
```

如果测试数量变化，请更新本助手文档和 README。

## 生成 Wiki 节点的文件约定

有效的 v5 节点必须包含：

```yaml
nodeId: stable-node-id
kind: concept
title: 节点标题
sourceIds:
  - raw/pdf/source-id
sourceChase:
  - raw/chase/raw_pdf_source-id.md
chunkRefs:
  - 1
confidence: 0.9
status: verified
tags:
  - 标签
createdAt: "..."
updatedAt: "..."
```

可靠智能体使用所需的正文段落：

```text
## Claim（声明）
## Evidence（证据）
```

可选但有用：

```text
## Interpretation（解读）
## Use For（用途）
## Limits（限制）
## Links（链接）
```

支持的 kind 类型：

```text
concept | claim | method | case | equation | question | insight | anchor | counter
```

## 自动化质量关卡

完成一次导入后，要求：

```text
ingest.ok == true
audit.ok == true
audit.summary.missingEvidence == 0
audit.summary.invalidChunkRefs == 0
search 返回与预期关键词相关的匹配
query 对可从来源回答的问题返回至少一个来源
```

如果任何条件不满足，报告失败，不要声称 wiki 是可靠的。

## 推荐策略

默认：

```text
conservative
```

仅在用户要求更广泛的综合时使用 `balanced`。

仅在用户明确要求生成探索性洞察/问题/反论时使用 `expansive`。

已知问题：

- Conservative 策略在某些情况下仍可能允许编译输出产生 `insight` 节点。将此视为 v5 的已知缺陷，如果结果重要，需通过审计加人工抽查来验证。

## 错误处理

### 缺少 API 密钥

预期错误：

```json
{
  "ok": false,
  "error": "DEEPSEEK_API_KEY not set"
}
```

处理：

```bash
export DEEPSEEK_API_KEY=sk-xxx
```

### 连接错误

可能是 LLM API/网络问题。

处理：

- 在有网络的环境中重试；
- 如果在沙箱中运行，请求网络权限提升；
- 除非错误在没有网络限制的情况下可复现，否则不要修改源代码。

### 审计失败

处理步骤：

1. 阅读 `issues`。
2. 检查报告的 `filePath`。
3. 检查 `sourceChase`。
4. 检查 `chunkRefs`。
5. 如果节点生成不正确，重新运行导入。

## 智能体的 Git 规范

不要提交：

```text
raw/
wiki/
.codebase-memory/
dist/
node_modules/
```

这些是运行时、生成或工具产出物，除非用户明确要求否则不提交。

应提交：

```text
lite-llmwiki/src/
lite-llmwiki/tests/
lite-llmwiki/README.md
spec/
spec_process/
helper/
```

提交前：

```bash
git status --short
npm run typecheck
npm run test
npm run build
```

## 最小智能体操作手册

处理新的原始文件：

```bash
cd <repo-root>/lite-llmwiki
npm run build
node dist/cli.js ingest <路径> --auto --policy conservative --json
node dist/cli.js audit --json
# v6: 结构 + 语义审查（需要 DEEPSEEK_API_KEY）
node dist/cli.js audit --semantic --json
node dist/cli.js search "<预期关键词>" --json --max 10
node dist/cli.js query "<可从来源回答的问题>" --mode ask --json
```

决策规则：

- 如果 `ingest` 和 `audit` 通过，wiki 在机制上有效。
- 如果 `audit --semantic` 也通过，wiki 的 claim 与 chase 原文语义一致。
- 如果 `search` 和 `query` 返回相关的、有来源支持的结果，wiki 可用于基本的第二大脑检索。
- 如果 `query` 依赖 `missingEvidence`，请求或导入更多原始材料。
- 任何 audit 阶段返回 `ok: false` → 停止后续 query/inspire（spec 11.2 agent 协议）。

## Agent Failure Contract（spec 11.3）

所有核心命令（plan / ingest / audit / semantic-audit / query / inspire）在 failure 时必须返回：

```json
{
  "ok": false,
  "stage": "<plan | ingest | audit | semantic-audit | query | inspire>",
  "error": "<错误信息>",
  "blockingIssues": ["..."],
  "suggestedNextActions": ["..."]
}
```

agent 收到 `ok: false` 时应：
1. 读取 `stage` 知道在哪个阶段失败。
2. 读取 `error` 知道具体错误。
3. 读取 `suggestedNextActions` 知道下一步可以做什么。
4. 不要重试相同的命令，除非 `suggestedNextActions` 暗示（如设置环境变量后再试）。
