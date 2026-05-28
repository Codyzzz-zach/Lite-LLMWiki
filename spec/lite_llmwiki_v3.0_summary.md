# Lite-llmwiki 阶段性设计总结报告

*版本: v3.0-as-built | 日期: 2026-05-28 | 代码量: ~1580 行 TypeScript*

---

## 1. 设计哲学

### 1.1 核心命题

> **Human 和 AI 基于同一份 raw 材料达成认知共鸣，结晶为可复用的 wiki。**

### 1.2 四条原则

| 原则 | 说明 |
|------|------|
| **一切事实以 raw 为准** | Human 不提供新事实，只提供对 AI 解读的判断和方向 |
| **Human 知道 raw 里有什么** | 不是 "AI 帮人类发现未知"，是双方基于同一信息源对答案 |
| **逐条对齐，不同意不落盘** | AI 提 proposition（事实 + 解读），human 逐条验证后才写入 wiki |
| **AI 制造反直觉摩擦** | Devil's Advocate 不是挑材料的刺，是指出 raw 中挑战 human 认知习惯的结论 |

### 1.3 与 Superpowers Brainstorming 的区别

| | Superpowers | Lite-llmwiki |
|---|---|---|
| 方向 | AI 不懂用户要什么 → 对话搞懂 → 实施 | 双方都懂 raw → AI 提解读 → human 验证对齐 |
| Human 角色 | 信息提供方 | 质量验证方（只给方向，不给事实） |
| 产出 | spec 文档 | wiki 页面 |
| 对话模式 | AI 问，human 答 | AI 提案，human 确认/纠偏 |

---

## 2. 功能清单

### 2.1 已实现

| 功能 | 对应需求 | 入口 |
|------|---------|------|
| **MD/PDF 源加载** | 读取论文、笔记、设计文档 | `loader.ts` / `pdf-loader.ts` |
| **Brainstorm（初读提炼）** | AI 读 raw，输出主线 + 对齐提案 | `ingest` 命令 Phase 1 |
| **主线选择** | Human 选择关注方向（<5 chunks 自动跳过） | CLI 交互 / TUI |
| **逐条确认 (a/s/m)** | Human 验证每条 AI 解读 | `ingest` 命令 Phase 2 |
| **m 模式（换角度重读）** | Human 给新方向，AI 即时 re-read 目标 chunk | `reread` API 模式 |
| **m 上限 3 次** | 防止无限循环 | CLI / TUI 内建 |
| **m 后选择原版/修订版** | m 触发 re-read 后 human 可选保留原版 | waiting_version 阶段 |
| **a all 批量确认** | 快速通过剩余全部 proposition | CLI / TUI |
| **Compile（编译 wiki）** | 已确认 proposition → wiki 文件 | `ingest` 命令 Phase 3 |
| **反直觉视角 (DevIL's Advocate)** | 指出 raw 中挑战 human 认知习惯的结论 | 随 compile 落盘 |
| **THC 认知假设** | 2-3 个认知映射假设 | 随 compile 落盘 |
| **四层前缀缓存** | System + Workspace + Material + Variables | `prefix.ts` |
| **双模式共享前缀（brainstorm + compile 缓存命中）** | 降低 API 成本 | `prefix.ts` |
| **query 知识查询** | 关键词搜索 wiki + Pro 合成回答 | `query` 命令 |
| **node 查看页面** | 查看单个 wiki 文件 | `node` 命令 |
| **status 统计** | raw/wiki 文件计数 | `status` 命令 |
| **TUI 终端界面** | Ink + React 全交互 | `chat` 命令 |

### 2.2 应该实现但尚未实现

| 功能 | 优先级 | 说明 |
|------|--------|------|
| **compile 页面篇幅控制** | 高 | 当前短文档 compile 输出过短，需加最小篇幅指令 |
| **re-ingest 去重** | 高 | 同一 raw 被 ingest 两次，旧 wiki 应更新而非追加。用户已确认方向：覆盖 |
| **brainstorm 中断恢复** | 中 | Ctrl+C 后 brainstorm 结果丢失。应暂存到临时文件，支持 `--resume` |
| **query 结果质量** | 中 | 当前纯关键词 grep，短文档可能漏相关页面。proposition 的 chunkRefs 已有精确引用，可为 query 提供更准的来源锚定 |
| **anchor 节点关联到 wiki 页面** | 低 | 当前 anchor 只记录原始文本，未链接到生成的 wiki 页面 |

### 2.3 不需要实现

| 功能 | 原因 |
|------|------|
| SQLite 图谱 (nodes/edges) | 个人场景下文件系统 grep 足够 |
| Flash Compiler（独立子代理） | Pro 模型一步走通，格式化为冗余步骤 |
| entities / concepts 分立 | 未发现分立必要性 |
| 多轮 Listening（逐 chunk 调用） | MVP 单轮已覆盖验证范围 |
| 语义去重（embedding） | 当前 ingest 量级不应触发需求 |
| multi-agent / 多租户 | not relevant |

### 2.4 未来可以去实现

| 方向 | 触发条件 |
|------|---------|
| 出口 Agent（联想查询 `:relate` / 定期回顾 `:review`） | wiki 节点达到 50+ |
| compile 输出质量优化（分节展开 + 证据引用格式统一） | 用户反馈 compile 太简略 |
| Obsidian 双向链接自动生成 | wiki 文件格式对接 Obsidian |
| `--auto` 非交互模式（批量 ingest） | CI/批量场景需求 |
| 跨材料冲突检测（ingest 时对比已有 wiki 节点） | 已有 wiki 节点数足够时 |

---

## 3. 当前架构

### 3.1 文件结构

```
src/
├── types.ts              # 全部类型定义 (139 行)
├── config.ts             # 环境加载 + AppConfig (70 行)
├── index.ts              # 库入口 (25 行)
├── core/
│   ├── client.ts         # DeepSeek API 客户端 (145 行)
│   └── prefix.ts         # 四层前缀 + 三模式 system prompt (256 行)
├── ingest/
│   ├── loader.ts         # MD 加载 + frontmatter + 分块 (165 行)
│   ├── pdf-loader.ts     # PDF 加载 (97 行)
│   └── listening.ts      # proIngest: brainstorm/reread/compile (164 行)
├── knowledge/
│   └── store.ts          # 纯文件存储 raw/ + wiki/ (145 行)
├── query/
│   └── engine.ts         # 关键词搜索 + Pro 合成回答 (88 行)
└── cli/
    ├── index.ts           # commander 入口 (37 行)
    ├── commands/
    │   ├── ingest.ts      # ingest 三阶段流程 (272 行)
    │   ├── query.ts       # query 命令 (39 行)
    │   ├── node.ts        # node 命令 (37 行)
    │   ├── status.ts      # status 命令 (28 行)
    │   └── chat.ts        # TUI 入口 (13 行)
    └── ui/
        ├── App.tsx        # TUI 主应用 (370 行)
        ├── InputLine.tsx  # 输入组件 (85 行)
        ├── MessageLog.tsx # 消息日志 (68 行)
        └── StatusLine.tsx # 状态栏 (20 行)
```

### 3.2 数据流

```
raw (PDF/MD)
  │
  ├─ loader ──→ Source { chunks, title, fingerprint }
  │
  ├─ Phase 1: brainstorm ──→ mainThreads[] + propositions[]
  │     (Pro API call 1, 全量 chunks, 写入前缀缓存)
  │
  ├─ Phase 2: 逐条确认
  │     ├─ a → confirmed
  │     ├─ s → skip
  │     ├─ a all → 批量 confirmed
  │     └─ m → human 给角度 → reread API (仅目标 chunk) → 展示修订版
  │              └─ a(原版) / r(修订版) / m(再试, max3)
  │
  ├─ Phase 3: compile ──→ WikiPage[]
  │     (Pro API call, confirmed 的 propositions JSON, system 前缀缓存命中)
  │
  └─ Save ──→ raw/md/<source>.md + wiki/concepts/<nodeId>.md
               + _devils-advocate-<hash>.md + anchor-<hash>.md
```

### 3.3 API 成本模型

| 阶段 | 模型 | Input 估算 | 缓存命中 | 说明 |
|------|------|-----------|---------|------|
| brainstorm | Pro | ~3K (system, 缓存) + chunks (全量) | system 部分写入缓存 | 最贵的一次 |
| reread (m 触发) | Pro | ~3K (system, 命中) + 目标 chunk (~1K) | system 全命中 | 极轻量 |
| compile | Pro | ~3K (system, 命中) + confirmed JSON (~1K) + chunks (全量) | system 全命中 | 中等 |

---

## 4. 核心交互协议

### 4.1 CLI

```
$ llmwiki ingest <file> -m "anchor"
  → [Phase 1] Brainstorm → 显示主线 (chunks < 5 自动全选)
  → [Phase 2] 逐条 proposition:
        [a] 对齐   [s] 跳过   [m] 不同角度   [a all] 批量确认
        m → 输入角度 → reread → 展示原版 vs 修订版:
          [a] 对齐原版  [r] 对齐修订版  [m] 再换个角度  [s] 跳过
  → [Phase 3] Compile → Save

$ llmwiki query "问题"
$ llmwiki node <id>
$ llmwiki status
$ llmwiki chat   # TUI
```

### 4.2 TUI

```
:ingest <file>        加载材料
:anchor "问题"        Brainstorm → 逐条确认
:query "问题"         查询知识库
:node <id>            查看 wiki 页面
:status               统计
:clear                清屏
```

---

## 5. 存储结构

```
<project-root>/
├── raw/md/                        # 原始材料副本
├── wiki/concepts/                 # wiki 页面（frontmatter + body）
│   ├── <nodeId>.md                # 概念页面
│   ├── _devils-advocate-*.md      # 反直觉视角
│   └── anchor-*.md                # Human anchor 记录
├── spec/                          # 设计文档
└── purpose.md                     # 意图与过滤宪法
```

wiki 文件 frontmatter:
```yaml
---
title: <中文标题>
source: <材料标识>
confidence: 0.9
hypothesis: A
related: [concept/xxx]
createdAt: 2026-05-28T...
---
<Markdown body>
```

---

## 6. 与初始 Spec 的偏离

| 删除的设计 | 原因 |
|-----------|------|
| Flash Compiler | 模型相同下两步走是浪费 |
| SQLite 图谱 (nodes/edges) | 个人场景文件系统足够 |
| entities 分立目录 | 未发现必要 |
| multi-round Listening | MVP 不需要 |
| HypothesisPicker 中断式选择 | 被逐条确认替代 |

| 新增的设计 | 来源 |
|-----------|------|
| 逐条确认 (a/s/m) | 初始 spec 未定义 human 角色边界 |
| MainThread 主线选择 | 让 human 在确认前有方向感 |
| reread (m 模式) | Human 给方向，AI 即时重读 |
| a all 批量确认 | 减少体力操作 |
| m 后原版/修订版选择 | 防止 AI re-read 偏了 |

---

## 7. 已知问题

| 问题 | 严重度 | 状态 |
|------|--------|------|
| compile 对短文档输出过短（1 段 vs 期望 3-5 段） | 中 | 待加篇幅指令 |
| pipe 模式下首个 `\n` 被错误消费（非交互场景不影响功能） | 低 | 已知 |
| re-ingest 同一文件无去重/更新逻辑 | 中 | 已确认方向，待实现 |

---

*本文档反映 2026-05-28 代码库实际状态。*
