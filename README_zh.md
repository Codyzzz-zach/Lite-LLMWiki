<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./image/logo-dark.svg">
    <img alt="LiteWikiagent" src="./image/logo-light.svg" width="360px">
  </picture>
  <p style="margin-top: 12px; font-size: 15px; color: #52525b;">
    Agent 优先的知识编译器 —— 把原始文件变成可审计的 wiki，让 LLM 在你的知识局面上精确推理。
  </p>
</div>

<p align="center">
  <a href="./LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-0D5C41?style=flat-square" /></a>
  <a href="#"><img alt="Node" src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" /></a>
  <a href="#"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square" /></a>
  <a href="#"><img alt="DeepSeek" src="https://img.shields.io/badge/LLM-DeepSeek-00D97E?style=flat-square" /></a>
  <br />
  <br />
</p>

<p align="center">
  <a href="#快速开始">快速开始</a>
  ·
  <a href="#核心概念">核心概念</a>
  ·
  <a href="#命令参考">命令参考</a>
  ·
  <a href="#开发">开发</a>
  ·
  <a href="./helper/human/helper.zh.md">用户指南</a>
  ·
  <a href="./spec/lite_llmwiki_v6.0.md">设计文档 (v6)</a>
</p>

---

<details>
<summary><b>目录</b>（点击展开）</summary>

- [设计哲学](#设计哲学)
- [快速开始](#快速开始)
- [核心概念](#核心概念)
- [命令参考](#命令参考)
  - [通用参数](#通用参数)
  - [导入 (ingest)](#导入-ingest)
  - [审计 (audit)](#审计-audit)
  - [搜索 (search)](#搜索-search)
  - [查询 (query)](#查询-query)
  - [灵感 (inspire)](#灵感-inspire)
- [导入策略](#导入策略)
- [项目结构](#项目结构)
- [开发](#开发)
- [许可证](#许可证)

</details>

---

## 设计哲学

LiteWikiagent 把 wiki 视为**棋盘局面**，而不是教科书。

```text
你负责选材 → 系统忠实编译 → wiki 承载可审计的结构 → LLM 扮演棋手
```

没有 AI 门卫替你判断材料"值不值得入库"。质量闸门在**审计**，不在入口——每个 wiki 节点必须携带可追溯到源头的证据。

**这对实际操作意味着什么：**
- 入库零摩擦——把文件放进 `raw/original/` 就完事
- wiki 是结构化的，不是生成的——有 claim、evidence、limits、counter 角度
- query mode 是摆盘方式，不是提示词模板——`ask`、`trace`、`expand`、`challenge`
- LLM 在你的知识结构**内部**推理，而不是在松散的向量汤上跳舞

> [!NOTE]
> LiteWikiagent 为 DeepSeek 而建（通过 API Key），完全基于你的本地文件系统运行——没有云端同步，没有 SaaS 绑定。

---

## 快速开始

```bash
# 1. 克隆并安装
cd lite-llmwiki
npm install
npm run build

# 2. 设置 API 密钥
export DEEPSEEK_API_KEY=sk-your-key-here

# 3. 把文件放进 raw/original/
#    支持格式: .md / .pdf / .tex（整个论文文件夹）

# 4. 导入你的第一份文档
llmwiki ingest ../raw/original/md/我的笔记.md --auto --policy conservative --json

# 5. 审计验证
llmwiki audit

# 6. 查询你的知识
llmwiki query "这篇论文对失败概率的基线怎么看？" --mode trace --json
```

---

## 核心概念

### 数据管线

```text
raw/original/     ──→   raw/chase/    ──→   wiki/    ──→   audit → search → query → inspire
（你放进来的文件）       （清洗后的 Markdown）    （知识节点）           （验证并使用）
```

| 层级 | 位置 | 用途 |
|-------|----------|---------|
| **原始层** | `raw/original/<format>/` | 原始材料——PDF、Markdown、TeX |
| **追溯层** | `raw/chase/` | 清洗后的 Markdown 审计追踪——LLM 工作的精确文本层 |
| **wiki 层** | `wiki/` | 结构化的知识节点，包含 `Claim`、`Evidence`、`chunkRefs` |

### Wiki 节点类型

每个节点通过 `sourceChase` + `chunkRefs` 链接回源头：

| 类型 | 用途 |
|------|---------|
| `concept`（概念） | 原子知识单元——定义、主题 |
| `claim`（论断） | 有据可依的具体断言 |
| `method`（方法） | 可复现的过程或技术 |
| `case`（案例） | 具体实例 |
| `equation`（公式） | 带解释的公式 |
| `question`（问题） | 源头材料中提出的开放问题 |
| `insight`（洞察） | 跨来源综合观察 |
| `counter`（反论） | 矛盾或对立视角 |

### 审计保证

审计不通过，wiki 不可信：

```text
PASS
coverage: 100%
missing evidence: 0
invalid chunkRef: 0
```

> [!WARNING]
> 如果审计结果显示缺失证据或无效的 chunk 引用，在修复相关节点之前**不要**信任查询结果。

---

## 命令参考

### 通用参数

| 参数 | 类型 | 说明 |
|------|------|-------------|
| `--json` | 开关 | 输出结构化 JSON（用于脚本接管） |
| `--auto` | 开关 | 跳过交互式确认 |
| `--policy` | 枚举 | `conservative`（默认）/ `balanced` / `expansive` |

### 导入 (ingest)

```bash
# 交互式
llmwiki ingest ../raw/original/pdf/e-的基本画像.pdf

# 非交互式（推荐用于自动化）
llmwiki ingest ../raw/original/pdf/e-的基本画像.pdf --auto --policy conservative --json

# TeX 项目文件夹
llmwiki ingest ../raw/original/tex/arXiv-1503.02531v1 --auto --policy conservative --json
```

将原始文档转化为结构化 wiki 节点。导入引擎的工作流：
1. 提取清洗后的 Markdown 到 `raw/chase/`
2. 按节点类型生成 wiki 节点
3. 将每个节点链接回源文本的块引用

### 审计 (audit)

```bash
# 结构审计（快速，无 API 调用）
llmwiki audit --json

# 语义审计（LLM 驱动，检查语义漂移）
llmwiki audit --semantic --json
```

| 级别 | 检查内容 | API 消耗 |
|-------|---------------|----------|
| `audit` | nodeId、kind、sourceChase、chunkRefs、Claim/Evidence 段落 | 无 |
| `audit --semantic` | 上述所有 + LLM 对 claim 语义忠实度的评估 | 1 次 API 调用 |

### 搜索 (search)

```bash
llmwiki search "1/e 失败概率" --json
```

本地、快速、不消耗 API。按关键词匹配 wiki 节点。

### 查询 (query)

```bash
# 直接提问
llmwiki query "为什么 1/e 可以作为失败概率基线？" --mode ask --json

# 追溯来源
llmwiki query "这个论点从哪里来的？" --mode trace --json

# 探索其他解读
llmwiki query "这个结果还有哪些可能的解读方式？" --mode expand --json

# 挑战结论
llmwiki query "这个推理在严密审视下站得住脚吗？" --mode challenge --json
```

| 模式 | 摆盘方式 | 做什么 |
|------|-------------------|-------------|
| `ask` | 直接召回 | 拉取相关 wiki 节点，综合回答 |
| `trace` | 溯源追踪 | 沿 `sourceChase` + `chunkRefs` 追溯到原文 |
| `expand` | 发散探索 | 探索相邻节点、反论、待解问题 |
| `challenge` | 压力测试 | 寻找边界、矛盾、缺失证据 |

> [!NOTE]
> Query mode 不是提示词模板，而是**摆盘方式**——它控制哪些 wiki 节点被召回、证据如何呈现给 LLM。

### 灵感 (inspire)

```bash
llmwiki inspire --json
```

在你的 wiki 中寻找意外的跨节点连接。适合偶然性发现的场景。

> [!WARNING]
> `inspire` 目前是基础的节点采样机制，尚未实现完整结构化灵感引擎。详见 [v6 设计文档](./spec/lite_llmwiki_v6.0.md)。

---

## 导入策略

导入策略控制引擎生成 wiki 节点的激进程度：

| 策略 | 行为 | 适用场景 |
|--------|----------|----------|
| `conservative`（保守） | 仅事实性内容——概念、方法、案例、公式、有据可依的论断 | 日常使用，构建可靠知识库 |
| `balanced`（平衡） | 保守 + 一定程度综合与解读 | 需要有用摘要时 |
| `expansive`（扩展） | 全面探索——洞察、问题、反论视角 | 探索发现、头脑风暴，不适合作为基线策略 |

---

## 项目结构

```text
LiteWikiagent/
├── image/                  # 品牌资产（Logo、图标、色板）
├── lite-llmwiki/           # TypeScript CLI 包
│   ├── src/                # 源代码
│   └── tests/              # 测试套件
├── raw/                    # 你的知识文件（gitignore）
│   ├── original/           #   原始材料
│   │   ├── md/             #     Markdown 笔记
│   │   ├── pdf/            #     PDF 文档
│   │   └── tex/            #     TeX 论文文件夹
│   └── chase/              #   清洗后的 Markdown（自动生成）
├── wiki/                   # 编译后的知识节点（自动生成）
├── spec/                   # 设计规范与架构
├── spec_process/           # 实现复盘与路线图
├── helper/                 # 用户 & Agent 使用指南
│   ├── human/              #   面向人类用户
│   └── agent/              #   面向调用 API 的 AI Agent
└── scripts/                # 工具脚本
```

---

## 开发

```bash
cd lite-llmwiki

# 安装依赖
npm install

# 类型检查
npm run typecheck

# 运行测试
npm run test

# 构建
npm run build

# 开发模式（直接运行 CLI）
npm run dev -- ingest ../raw/original/md/测试.md --auto --policy conservative --json
```

---

## 许可证

MIT © LiteWikiagent 贡献者。

---

<p align="center">
  <sub>
    核心理念：<b>LLM 是棋手</b>，给它棋盘，而不是教科书。
  </sub>
</p>
