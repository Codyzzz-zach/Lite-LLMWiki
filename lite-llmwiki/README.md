# lite-llmwiki

DeepSeek-native 终端知识工作台。

<!-- TOC -->
- [简介](#简介)
- [快速开始](#快速开始)
- [Ingest 流程](#ingest-流程)
- [输入格式](#输入格式)
- [CLI 命令](#cli-命令)
- [设计哲学](#设计哲学)
- [开发](#开发)
- [架构](#架构)

---

## 简介

将论文、笔记、报告等 raw 知识文件，通过 AI 转化为结构化的 wiki 知识库。核心是 Human 和 AI **逐条对齐认知**——AI 从 raw 中提取事实并给出解读，人类逐条验证后才写入 wiki。

## 快速开始

```bash
# 设置 API key
export DEEPSEEK_API_KEY=sk-xxx

# 摄入一篇 markdown
llmwiki ingest paper.md -m "核心方法是什么"

# 摄入 LaTeX 论文文件夹
llmwiki ingest ./arXiv-paper/ -m "核心方法"

# 摄入 PDF 短文档
llmwiki ingest report.pdf -m "结论"

# 跳过交互（脚本友好）
llmwiki ingest paper.md --thread all

# 查询知识
llmwiki query "和我之前那篇论文有什么关联？"

# 统计
llmwiki status
```

## Ingest 流程

```
raw (.md / .tex / TeX 文件夹 / .pdf)
  → AI 初读 brainstorm → 输出主线 + propositions（含反直觉标注）
  → 人类逐条确认：a(对齐) / s(跳过) / m(换角度重读)
  → AI 编译已确认的知识 → wiki 文件
  → 自动生成 index + 日志
```

每次 ingest 默认需要人类逐条确认，也可用 `--thread all + a all` 全自动。

## 输入格式

| 格式 | 处理方式 | 适合场景 |
|------|---------|---------|
| `.md` | 直接加载 | 笔记、报告 |
| `.tex` | 单文件或文件夹，解析 `\input{}` 拼接，Pro 清洗 → MD | 论文源码（主力通道） |
| `.pdf` | pdf-parse 提取 + Pro 清洗 → MD | 短文档、不支持 TeX 的论文 |

长论文（>20 页）推荐使用 TeX 源文件。

## CLI 命令

```bash
ingest <path>         核心命令：摄入文件或 TeX 文件夹
  -m, --anchor <text> 一句直觉或问题
  -t, --thread <id>   跳过主线选择："all" 或数字

query <question>      查询知识库
node <id>             查看 wiki 页面
status                统计

chat                  启动 TUI (Ink + React)
```

## 设计哲学

- **事实以 raw 为准** — human 不提供新事实，只给方向和判断
- **不确认不落盘** — 每条 AI 解读必须经 human 验证才写入 wiki
- **反直觉标注在 proposition 内** — 不绕开 human 确认，一起验证
- **四层前缀缓存** — brainstorm 和 compile 共享 system prompt，降低 API 成本

## 开发

```bash
npm install
npm run build        # tsup 构建
npm run ingest -- README.md -m "测试"   # 单次运行
npm run dev -- ingest README.md -m "测试"  # tsx 直接运行
```

## 架构

```
cli (ingest/query/node/status) → core/prefix (prompt 管理)
        ↓                              ↓
ingest/{loader,tex,pdf}-loader  ←  core/client (DeepSeek API)
        ↓
ingest/listening (proIngest: brainstorm/reread/compile)
        ↓
knowledge/store (文件存储 + index/log)
        ↓
wiki/concepts/ + raw/
```

详见 [spec/](spec/) 目录。

## 许可

MIT
