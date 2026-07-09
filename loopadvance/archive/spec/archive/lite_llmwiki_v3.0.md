# lite-llmwiki v3.0 设计文档

*2026-05-28*

---

## 1. 设计哲学

### 产品定位

**Human 和 AI 基于同一份 raw 材料达成认知共鸣，结晶为可复用的 wiki。**

不是"AI 帮人类发现未知内容"，而是"双方手上都有同一份材料，AI 提解读，人类验证对齐"。一切事实以 raw 为准，人类只提供方向和判断。

### 三条原则

**事实主权在 raw。** Human 不提供新事实。Proposition 的 claim 全部来源于 raw chunk，AI 的角色是解读，不是补充。

**不确认不落盘。** AI 输出 N 条 proposition（事实 + 解读），human 逐条做 a（对齐）/ s（跳过）/ m（换角度重读）。只有 human 确认过的才进入 compile → wiki。

**制造认知摩擦，不挑材料毛病。** 反直觉标注不是审稿——是提醒 human「raw 里这个结论，和你惯常以为的不一样」。

### 与 Superpowers Brainstorming 的本质区别

Superpowers 的 brainstorming 是「AI 不懂用户要什么，通过对话搞懂」。lite-llmwiki 是「双方都懂 raw，AI 提解读，human 质检」。方向相反，human 的角色从信息提供方变成质量验证方。

---

## 2. 已完成的工作

从初始 spec（v2.0 图谱 + Flash 编译 + THC 假设选择）开始，我们做了一系列结构性的重构和迭代：

### 第一轮：砍掉不需要的

| 删除 | 原因 |
|------|------|
| SQLite 图谱（GraphDb 398 行） | 个人场景下 grep wiki 目录就够了 |
| Flash Compiler（157 行） | Pro/Flash 模型相同，两步走是浪费一次 API 调用 |
| entities/concepts 目录分立 | 没有遇到需要分开的场景 |
| HypothesisPicker 中断式选择 | 被逐条确认替代 |

### 第二轮：确立 ingest 三阶段

```
brainstorm → 逐条确认 → compile
```

- **brainstorm**: Pro 一次性读完所有 chunk，输出 mainThreads（主线）+ propositions（事实+解读+反直觉标注）
- **逐条确认**: human 对每条 proposition 做 a/s/m。m 触发 reread（Pro 仅读取目标 chunk 重读），最多 3 次，m 后可选原版或修订版。a all 支持批量确认剩余全部。
- **compile**: 只把已确认的 proposition 编译成 wiki 页面，system prompt 前缀与 brainstorm 完全一致 → 缓存命中

### 第三轮：反直觉视角重新设计

从独立 devilsAdvocate 字段（绕过 human 确认）改为 proposition 内的 counterIntuitive 标注——每条 proposition 可标注「这个结论挑战了人类的什么习惯认知」。human 在逐条确认时一起看到，确认后才进入反直觉汇总文件。

### 当前代码状态

~1600 行 TypeScript，零原生依赖，纯文件存储（raw/ + wiki/）。

---

## 3. 系统架构

### 整体结构

```
raw (PDF/MD)
  │
  ├─ loader ──→ Source {id, chunks, fingerprint}
  │
  ├─ [Phase 1] brainstorm (API call #1, 全量 chunks)
  │     └─→ mainThreads[] + propositions[] (含 counterIntuitive)
  │
  ├─ [Phase 2] 逐条确认 (human + 可选 reread API)
  │     ├─ a → confirmed
  │     ├─ s → skip
  │     ├─ a all → 批量 confirmed
  │     └─ m → reread API → 展示修订版 → a(原版)/r(修订版)/m(再试)×3
  │
  ├─ [Phase 3] compile (API call, confirmed JSON, system 命中缓存)
  │     └─→ WikiPage[]
  │
  └─ Save ──→ raw/md/<source>.md
             wiki/concepts/<nodeId>.md
             wiki/concepts/_devils-advocate-<hash>.md
             wiki/concepts/anchor-<hash>.md
```

### 模块分工

| 模块 | 职责 | 关键设计 |
|------|------|---------|
| `core/prefix.ts` | 四层前缀 + 双/三模式 system prompt | brainstorm/compile 共享 system 前缀 → compile 缓存命中 |
| `core/client.ts` | DeepSeek API 封装 | 基于 openai SDK，记录缓存命中 tokens |
| `ingest/listening.ts` | proIngest: brainstorm/reread/compile | 三模式统一函数，MODE 字段区分 |
| `ingest/loader.ts` | MD 加载 + frontmatter 解析 + 按段落分块 + token 估算 | 中文 2 char/token，英文 4 char/token |
| `ingest/pdf-loader.ts` | PDF 文本提取 | pdf-parse，复用 loader.ts 的分块逻辑 |
| `knowledge/store.ts` | 纯文件存储 | raw/ 副本保存 + wiki/ 读写/搜索，无外部依赖 |
| `query/engine.ts` | 知识查询 | 关键词搜索 wiki + Pro 合成回答 |

### 存储布局

```
<project-root>/
├── raw/md/                        # 原始材料（含指纹去重）
├── wiki/concepts/                 # 所有 wiki 产物
│   ├── <slug>.md                  # 概念页面（frontmatter + body）
│   ├── _devils-advocate-*.md      # 反直觉视角汇总
│   └── anchor-*.md                # Human anchor 记录
└── spec/                          # 设计文档
```

---

## 4. 核心类型

```typescript
// Phase 1 输出
MainThread { id, title, description, chunkRefs }

// Phase 2 交互单元
Proposition {
  id, threadId,                    // 归属主线
  claim, aiReading, chunkRefs,     // 事实 + 解读 + 证据位置
  revision,                        // m 触发次数 (0-3)
  counterIntuitive?,               // 是否标注反直觉
  counterIntuitiveReason?          // 反直觉的理由
}

// Phase 2 确认结果
ConfirmedProposition {
  ...Proposition,
  status: "confirmed" | "skip"
}

// Phase 3 产出
WikiPage { nodeId, filePath, frontmatter, body }
```

---

## 5. API 成本

| 阶段 | 输入 | 缓存 | 说明 |
|------|------|------|------|
| brainstorm | ~3K (system) + chunks | system 写入缓存 | 最贵的一次 |
| reread (m) | ~3K (命中) + 目标 chunk | system 全命中 | ~1K input |
| compile | ~3K (命中) + confirmed JSON + chunks | system 全命中 | 通常 < 总 chunks 的 20% |

---

## 6. 待实现

1. **compile 篇幅控制** — 短文档 compile 输出过短，需加最小篇幅指令
2. **re-ingest 更新** — 同一材料重新 ingest 应覆盖旧 wiki
3. **中断恢复** — brainstorm 后暂存结果，支持 `--resume`

---

## 7. 产出物清单

| 文件 | 状态 |
|------|------|
| `src/` — 完整 TypeScript 源码 | ~1600 行，零原生依赖 |
| `spec/lite_llmwiki_v3.0_simple.md` | 一页纸总结 |
| `spec/lite_llmwiki_v3.0_summary.md` | 详细报告（含偏离分析） |
| `spec/brainstorm_module_spec.md` | Brainstorm 模块独立设计 spec |
| `spec/variance_analysis.md` | 偏离初始 spec 分析 |
| CLI 命令: ingest / query / node / status / chat | 全部可用 |
| TUI: Ink + React 交互界面 | 全部可用 |
