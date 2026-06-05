# LiteWikiagent 用户工具说明书

本文以当前代码实现为唯一事实依据，说明用户如何把一份本地材料写入 wiki，并在 Reasonix、Codex、Claude Code、opencode 等 agent 中调用这个工具完成审查和提问。

## 一句话说明

LiteWikiagent 是一个本地知识库 CLI。

你把高度认同的材料放进 `raw/original/`，让 CLI 将它转成可审计的 wiki 节点，然后你可以对 wiki 做自动审查、本地搜索、证据问答和基础启发。

当前已经实现的主流程是：

```text
raw/original -> raw/chase -> wiki -> audit/search/query/inspire
```

## 你的用户故事是否已实现

### 场景 1：把认可的材料存到本地知识库 raw 文件夹

实现状态：已实现。

当前代码支持把材料放在：

```text
raw/original/md/
raw/original/pdf/
raw/original/tex/<paper-project-folder>/
```

支持格式：

- Markdown 文件；
- PDF 文件；
- 单个 TeX 文件；
- TeX 论文文件夹。

TeX 论文文件夹是重要实现点：一篇论文通常包含多个 `.tex` 文件，代码会先寻找包含 `\documentclass` 的主 `.tex` 文件，再解析 `\input{}` 和 `\include{}` 引用。

### 场景 2：打开 Reasonix，根据文件路径把知识写成 wiki

实现状态：已实现。

Reasonix 或其他 agent 可以调用：

```bash
node dist/cli.js ingest <path> --auto --policy conservative --json
```

这会执行：

```text
读取 raw 文件
-> PDF/TeX 清洗为 Markdown
-> 写入 raw/chase/
-> 抽取 propositions
-> 按 policy 自动确认
-> 编译为 wiki 节点
-> 更新 wiki/index.md、wiki/index.json、wiki/log.md
```

写入后的 wiki 文件位于：

```text
wiki/concepts/
wiki/methods/
wiki/cases/
wiki/equations/
wiki/questions/
wiki/insights/
wiki/anchors/
wiki/counters/
```

### 场景 3：先自动审查，再开始提问

实现状态：已实现基础版本。

自动审查命令：

```bash
node dist/cli.js audit --json
```

它会检查：

- wiki 节点是否有 `nodeId` 和 `kind`；
- 是否存在 `sourceChase`；
- `chunkRefs` 是否能在 chase 文件中找到；
- 是否有 Evidence section；
- 是否有 Claim section。

审查通过不等于语义完美，但表示该 wiki 节点具备基本证据链。

### 场景 4：几种提问模式

实现状态：部分实现。

当前代码没有实现 `query --mode <mode>` 这种单命令多模式结构。

实际已经存在的是几类不同命令和参数组合：

| 用户意图 | 当前命令 | 是否调用 LLM | 当前实现状态 |
| --- | --- | --- | --- |
| 查 wiki 里有没有相关内容 | `search <query>` | 否 | 已实现 |
| 基于 wiki 回答问题 | `query <question>` | 是 | 已实现 |
| 调整问答引用节点数量 | `query <question> --max <n>` | 是 | 已实现 |
| 让旧版 wiki 页也参与回答 | `query <question> --include-legacy` | 是 | 已实现 |
| 随机抽取一个节点作为启发 | `inspire` | 否 | 已实现基础版本 |
| 只做提取计划，不写 wiki | `plan <path>` | 是 | 已实现 |

还没有实现：

- 显式的“精确问答 / 发散问答 / 反问 / 启发 / 对比”query mode；
- 多节点张力检测；
- 结构化 inspiration 输出；
- 自动语义偏移评分。

## 安装

进入 CLI 包目录：

```bash
cd <repo-root>/lite-llmwiki
```

安装依赖：

```bash
npm install
```

构建：

```bash
npm run build
```

设置 DeepSeek API Key：

```bash
export DEEPSEEK_API_KEY=sk-xxx
```

也可以在 `lite-llmwiki/.env` 中写入：

```text
DEEPSEEK_API_KEY=sk-xxx
```

当前默认模型来自代码：

```text
deepseek-v4-pro
```

可选配置：

```bash
export DEEPSEEK_BASE_URL=https://api.deepseek.com
```

## 项目目录

从仓库根目录看：

```text
LiteWikiagent/
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
  lite-llmwiki/
  spec/
  spec_process/
  helper/
```

目录含义：

- `raw/original/`：你保存原始材料的位置。
- `raw/chase/`：系统保存清洗后 Markdown 的位置，是 wiki 审查依据。
- `wiki/`：系统生成的知识节点。
- `lite-llmwiki/`：CLI 源码和构建目录。
- `helper/`：人类和 agent 使用说明。

注意：`raw/` 和 `wiki/` 是本地知识库数据，默认被 gitignore。

## 从零开始使用

### 步骤 1：保存材料

PDF：

```text
raw/original/pdf/e 的基本画像.pdf
```

Markdown：

```text
raw/original/md/my-note.md
```

TeX 论文：

```text
raw/original/tex/arXiv-1503.02531v1/
  main11.tex
  introduction11.tex
  discussion11.tex
  ...
```

### 步骤 2：构建 CLI

```bash
cd <repo-root>/lite-llmwiki
npm run build
```

### 步骤 3：写成 wiki

推荐非交互命令：

```bash
node dist/cli.js ingest ../raw/original/pdf/e\ 的基本画像.pdf --auto --policy conservative --json
```

Markdown 示例：

```bash
node dist/cli.js ingest ../raw/original/md/my-note.md --auto --policy conservative --json
```

TeX 论文文件夹示例：

```bash
node dist/cli.js ingest ../raw/original/tex/arXiv-1503.02531v1 --auto --policy conservative --json
```

推荐默认 policy：

```text
conservative
```

原因：它更偏向事实、方法、公式、案例，适合作为可靠知识库入口。

### 步骤 4：检查 ingest 输出

成功时 JSON 类似：

```json
{
  "ok": true,
  "sourceId": "raw/pdf/e 的基本画像-d22f38f18f084231",
  "sourceChase": "<repo-root>/raw/chase/raw_pdf_e 的基本画像-d22f38f18f084231.md",
  "created": [
    "wiki/equations/1e-limit-definition.md"
  ],
  "updated": [],
  "skipped": [],
  "coverage": {
    "coveredChunks": 4,
    "totalChunks": 4,
    "uncoveredReasons": []
  }
}
```

关键字段：

- `ok: true`：写入流程成功。
- `sourceId`：这份材料的稳定来源 ID。
- `sourceChase`：清洗后的 Markdown 文件。
- `created`：新建的 wiki 节点。
- `coverage`：抽取结果覆盖了多少 source chunks。

如果 `ok: false`，不要直接进入 query；先解决错误。

### 步骤 5：自动审查

```bash
node dist/cli.js audit --json
```

通过时类似：

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

建议判断标准：

```text
ok == true
missingEvidence == 0
invalidChunkRefs == 0
```

如果 audit 失败，先看 `issues`。不要把失败的 wiki 当作可靠知识库。

## 提问和使用 wiki

### 模式 1：本地搜索

适合问题：

- “wiki 里有没有这个概念？”
- “哪些节点和这个关键词有关？”

命令：

```bash
node dist/cli.js search "1/e 失败概率" --json
```

特点：

- 不调用 LLM；
- 快；
- 返回匹配节点、claim、evidence；
- 适合作为问答前的检索。

### 模式 2：证据问答

适合问题：

- “为什么 1/e 可以作为失败概率基线？”
- “这份材料里关于某个方法是怎么说的？”

命令：

```bash
node dist/cli.js query "为什么 1/e 可以作为失败概率基线？" --json
```

输出包含：

- `answer`：回答；
- `sources`：使用到的 wiki 节点；
- `inferences`：基于 wiki 做出的推断；
- `missingEvidence`：缺少证据的部分；
- `usage`：token 用量。

使用规则：

- `sources` 是证据依据；
- `inferences` 不是原文事实；
- `missingEvidence` 表示需要补充材料或人工判断。

### 模式 3：扩大或缩小问答上下文

默认 query 使用最多 5 个 source nodes。

扩大上下文：

```bash
node dist/cli.js query "这个主题有哪些相关观点？" --json --max 10
```

缩小上下文：

```bash
node dist/cli.js query "这个公式是什么意思？" --json --max 3
```

### 模式 4：包含旧版 wiki 页

默认 query 不包含 legacy pages。

如果你需要旧版页面参与回答：

```bash
node dist/cli.js query "旧知识里有没有相关内容？" --json --include-legacy
```

注意：legacy pages 不一定有完整证据链，可靠性低于 v5 verified nodes。

### 模式 5：基础启发

命令：

```bash
node dist/cli.js inspire --json
```

按 kind 过滤：

```bash
node dist/cli.js inspire --json --kind concept
```

按 tags 过滤：

```bash
node dist/cli.js inspire --json --tags probability,limits
```

当前事实：`inspire` 是基础节点抽样/过滤，不是完整的多节点推理启发引擎。

### 模式 6：只规划，不写 wiki

适合在真正写入前先看 AI 会抽取什么。

命令：

```bash
node dist/cli.js plan ../raw/original/pdf/e\ 的基本画像.pdf --json
```

它会返回：

- source 信息；
- main threads；
- propositions；
- coverage。

它不会写 wiki。

## 人类手动交互流程

如果不用 `--auto`，`ingest` 会进入人工确认流程。

命令：

```bash
node dist/cli.js ingest ../raw/original/pdf/e\ 的基本画像.pdf
```

你可以：

- 选择主线；
- 对 proposition 逐条确认；
- 跳过不认可的内容；
- 要求 AI 从不同角度重读。

交互式流程适合你想控制每条知识是否进入 wiki 的情况。

## Reasonix / Agent 应如何调用

给 Reasonix 的最小工作流：

```bash
cd <repo-root>/lite-llmwiki
npm run build
node dist/cli.js ingest <raw-file-path> --auto --policy conservative --json
node dist/cli.js audit --json
node dist/cli.js search "<关键词>" --json
node dist/cli.js query "<问题>" --json
```

Agent 判断规则：

1. `ingest.ok` 必须是 `true`。
2. `audit.ok` 必须是 `true`。
3. 如果 `missingEvidence > 0` 或 `invalidChunkRefs > 0`，不要把 wiki 当可靠结果。
4. query 回答必须看 `sources`。
5. query 中的 `inferences` 只能当推断，不能当原文事实。
6. `missingEvidence` 出现时，应提示用户补充材料或进行人工判断。

## 当前已验证样例

已用以下材料跑通过基础端到端流程：

```text
raw/original/pdf/e 的基本画像.pdf
```

验证结果：

```text
ingest 成功
audit ok=true
verifiedNodes=9
missingEvidence=0
invalidChunkRefs=0
coverage=1
search 可召回相关节点
query 可基于 sources 回答
```

## 当前限制

以下能力尚未完整实现：

- 没有 `query --mode exact|explore|compare|counter` 这类显式提问模式。
- `inspire` 还不是完整的结构化启发系统。
- graph 功能尚未实现。
- 自动语义偏移评分尚未实现。
- conservative policy 与 compile 输出仍可能在边界情况下不完全一致。
- query 质量依赖 search 召回结果和 LLM API。

因此当前最可靠的使用方式是：

```text
ingest -> audit -> search -> query -> 人工抽查关键节点
```

## 故障处理

### 没有 API Key

现象：

```text
DEEPSEEK_API_KEY not set
```

处理：

```bash
export DEEPSEEK_API_KEY=sk-xxx
```

### 网络失败

现象：

```text
Connection error
```

处理：

- 确认网络可访问 DeepSeek API；
- 在受限环境中给 agent 网络权限；
- 重试命令。

### PDF 提取为空

现象：

```text
PDF extraction returned near-empty content. This may be a scanned document.
```

处理：

- 该 PDF 可能是扫描件；
- 需要先 OCR 成文本或 Markdown。

### TeX 主文件识别错误

代码优先找包含 `\documentclass` 的 `.tex` 文件；找不到时选最大 `.tex` 文件。

如果识别错误，请直接传入主 `.tex` 文件路径：

```bash
node dist/cli.js ingest ../raw/original/tex/paper/main.tex --auto --policy conservative --json
```

## 最终判断

按当前代码实现，你的核心用户故事已经具备可运行闭环：

```text
保存 raw -> agent 根据路径 ingest -> 生成 chase/wiki -> audit -> search/query
```

需要明确的是：现在已经实现的是“基础第二大脑 CLI”，不是完整 graph-based second brain。现阶段产品重点应继续放在：

- 提问模式标准化；
- `inspire` 结构化；
- 语义偏移审查；
- 多格式端到端测试；
- future graph 字段稳定化。

