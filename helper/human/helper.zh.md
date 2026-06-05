# LiteWikiagent 用户助手

本指南面向人类用户，介绍本工具能做什么、文件应该放在哪里、以及如何安全操作。

## 本工具的功能

LiteWikiagent 将原始知识文件转化为可溯源的 Markdown wiki。

适用于以下场景：

- 有 PDF、论文、文章、笔记或 TeX 源码文件夹；
- 想将文档转化为可复用的知识；
- 需要对自己的材料提问；
- 需要检查 AI 生成的 wiki 内容是否忠于原文。

核心流程：

```text
原始文件 -> 清洗后的 Markdown 追溯文件 -> 结构化 wiki 节点 -> 审计/搜索/查询
```

生成的 wiki 不是松散的摘要。每个合格的 wiki 节点都应指回清洗后的源文本和块引用。

## 用途

### 1. 构建个人知识 Wiki

你可以导入文档，让工具生成原子化的 wiki 页面：

- 概念（concepts）；
- 论断（claims）；
- 方法（methods）；
- 案例（cases）；
- 公式（equations）；
- 问题（questions）；
- 洞察（insights）；
- 反直觉观点（counters）。

这些页面保存在 `wiki/` 目录下。

### 2. 保留审计追踪

工具在 `raw/chase/` 中保留清洗后的 Markdown 副本。

这很重要，因为 PDF 和 TeX 文件难以直接检查。追溯文件是 LLM 工作时使用的精确文本层。Wiki 节点随后引用：

- `sourceChase`
- `chunkRefs`
- Evidence（证据）段落

这使得后续审查成为可能。

### 3. 对你的 Wiki 提问

导入材料后，你可以提问：

```bash
llmwiki query "为什么 1/e 可以作为失败概率基线？"
```

回答应包含来源，并尽可能区分有据可依的论断和推断性论断。

### 4. 搜索你的第二大脑

当你想在不调用 LLM 的情况下查找相关笔记时使用搜索：

```bash
llmwiki search "1/e 失败概率"
```

搜索是本地且快速的。

### 5. 检查 Wiki 是否可信

运行审计：

```bash
llmwiki audit
```

审计检查生成的 wiki 页面是否能追溯回 `raw/chase`。

## 推荐的文件夹结构

将原始文件放在仓库根目录：

```text
raw/
  original/
    md/
    pdf/
    tex/
      <论文项目文件夹>/
  chase/
wiki/
```

使用以下约定：

- Markdown 笔记放入 `raw/original/md/`。
- PDF 文件放入 `raw/original/pdf/`。
- TeX 论文文件夹放入 `raw/original/tex/<论文项目文件夹>/`。
- 除非你知道自己在做什么，否则不要手动写入 `raw/chase/`。
- 将 `wiki/` 视为可审计和可重新生成的输出。

TeX 注意事项：一篇论文通常有多个 `.tex` 文件，请将整个论文文件夹保持在一起。

## 安装

从包目录执行：

```bash
cd lite-llmwiki
npm install
npm run build
```

设置 API 密钥：

```bash
export DEEPSEEK_API_KEY=sk-xxx
```

如果你从 `lite-llmwiki/` 目录运行命令，根目录原始文件的路径通常以 `../` 开头。

## 基本工作流

### 第一步：将文件放入 `raw/original`

示例：

```text
raw/original/pdf/e 的基本画像.pdf
raw/original/md/my-note.md
raw/original/tex/arXiv-1503.02531v1/
```

### 第二步：导入文件

交互式：

```bash
llmwiki ingest ../raw/original/pdf/e\ 的基本画像.pdf
```

非交互式：

```bash
llmwiki ingest ../raw/original/pdf/e\ 的基本画像.pdf --auto --policy conservative --json
```

推荐日常使用的策略：

```text
conservative
```

它主要接受事实性节点，不太可能过度生成推测性内容。

### 第三步：审计 Wiki

```bash
llmwiki audit
```

好的结果应显示：

```text
PASS
coverage: 100%
missing evidence: 0
invalid chunkRef: 0
```

如果审计失败，在依赖查询回答之前，先检查报告的文件路径。

### 第四步：搜索

```bash
llmwiki search "关键词"
```

当你想知道 wiki 中是否已包含某内容时使用搜索。

### 第五步：查询

```bash
llmwiki query "你的问题"
```

当你希望系统从多个 wiki 节点综合出一个回答时使用查询。

### 第六步：检查 Wiki 文件

打开以下目录中的文件：

```text
wiki/concepts/
wiki/methods/
wiki/equations/
wiki/insights/
wiki/counters/
```

每个 v5 节点应有：

- frontmatter（元数据）；
- `## Claim`（声明）；
- `## Evidence`（证据）；
- 可选的 interpretation/use/limits 段落。

## 导入策略

### conservative（保守）

最佳默认选择。适用于保持源文忠实度和低语义漂移。

它偏好：

- 概念；
- 方法；
- 案例；
- 公式；
- 有据可依的论断。

### balanced（平衡）

当你想要更多有用的综合，且能容忍一些更宽泛的解读时使用。

### expansive（扩展）

当你明确想要探索性输出（如洞察、问题、反论角度）时使用。

不要将 expansive 作为构建可靠知识库的默认策略。

## 常用命令

```bash
# 构建
npm run build

# 导入 PDF
node dist/cli.js ingest ../raw/original/pdf/e\ 的基本画像.pdf --auto --policy conservative --json

# 导入 Markdown
node dist/cli.js ingest ../raw/original/md/my-note.md --auto --policy conservative --json

# 导入 TeX 文件夹
node dist/cli.js ingest ../raw/original/tex/arXiv-1503.02531v1 --auto --policy conservative --json

# 审计
node dist/cli.js audit --json

# 搜索
node dist/cli.js search "1/e 失败概率" --json

# 查询
node dist/cli.js query "为什么 1/e 可以作为失败概率基线？" --json

# 灵感
node dist/cli.js inspire --json
```

## 如何评判 Wiki 质量

生成的 wiki 在以下情况下可用：

- 审计通过；
- 每个重要节点都有 Evidence；
- 论断接近源文本；
- 解读有明确的限制说明；
- 查询回答引用了 wiki 来源；
- 查询回答在需要时指出缺失证据。

警告信号：

- 审计报告缺失证据；
- 审计报告无效的 chunk 引用；
- 节点论断宽泛但证据薄弱；
- 查询回答包含来源中不存在的论断；
- 小文档生成了许多页面但缺乏明确证据。

## 当前限制

当前系统可用，但尚未完成完整的 v5 第二大脑产品。

已知限制：

- `inspire` 仍为基础节点采样，不是完整的结构化灵感引擎。
- conservative 策略和编译输出在边缘情况下仍可能漂移。
- 跨文档链接有限。
- 图谱功能尚未实现。
- 语义漂移审计尚未完全自动化。

可靠使用建议：

```text
导入 -> 审计 -> 搜索/查询 -> 人工抽查
```

## 故障排除

### 缺少 API 密钥

设置：

```bash
export DEEPSEEK_API_KEY=sk-xxx
```

### PDF 或查询因连接错误失败

命令需要网络访问 LLM API。请在有网络的环境中重试。

### 审计失败

阅读审计问题。常见原因：

- 缺少 `raw/chase` 文件；
- `chunkRefs` 错误；
- 遗留的 wiki 页面；
- 生成的页面没有 Evidence。

### TeX 文件夹失败

检查文件夹是否包含带有 `\documentclass` 的主 `.tex` 文件。如果没有，加载器会回退到最大的 `.tex` 文件，这可能不正确。
