# lite-llmwiki v4.1 设计文档

*2026-06-01, ~1900 行 TypeScript*

---

## 1. 设计哲学

**Human 和 AI 基于同一份 raw 材料逐条对齐认知，只把双方都认可的结晶为 wiki。**

- 一切事实以 raw 为准——human 不提供新事实，只给方向和判断
- 不确认不落盘——AI 提 proposition（事实 + 解读），human 逐条 a/s/m 验证
- 反直觉标注在 proposition 内——不绕开 human 确认，和命题一起被验证

## 2. Ingest 流程

```
raw (.md / .tex / TeX 文件夹)
  → [load] Source {chunks, fingerprint}
  → [brainstorm] mainThreads + propositions（含 counterIntuitive）
  → [主线选择] 支持 --thread all|N 跳过交互
  → [逐条确认] a / s / m（max 3）/ a all
  → [compile] 已确认 proposition → newPages + updatedPages
  → [updatedPages 确认] a / s（如有）
  → [save] raw 副本 + wiki pages + devils-advocate + anchor
  → [index/log] 自动生成
```

## 3. 核心类型

```typescript
MainThread { id, title, description, chunkRefs }
Proposition { id, threadId, claim, aiReading, chunkRefs, revision,
              counterIntuitive?, counterIntuitiveReason? }
ConfirmedProposition { ...Proposition, status: "confirmed"|"skip",
                       counterIntuitive?, counterIntuitiveReason? }
WikiPage { nodeId, filePath, frontmatter, body, updateType? }
ProResult { mode, materialId, title, type,
            mainThreads?, propositions?, pages?, updatedPages?,
            hypotheses, feedbackText }
```

## 4. 架构

```
src/
├── types.ts              # 全部类型
├── config.ts             # 环境 + AppConfig (model: deepseek-v4-pro)
├── index.ts              # 库入口
├── core/
│   ├── client.ts         # DeepSeek API (OpenAI 兼容)
│   └── prefix.ts         # 双模式 system prompt + 四层前缀
├── ingest/
│   ├── loader.ts         # MD 加载
│   ├── tex-loader.ts     # LaTeX 文件夹/单文件加载 (resolveIncludes + resolveBbl + Pro 清洗)
│   ├── pdf-loader.ts     # PDF 加载 (已暂关, 保留完整逻辑)
│   └── listening.ts      # proIngest: brainstorm/reread/compile
├── knowledge/
│   └── store.ts          # 纯文件存储 + index/log + findRelatedPages
├── query/
│   └── engine.ts         # 关键词搜索 + Pro 合成回答
└── cli/
    ├── index.ts          # commander 入口
    ├── commands/         # ingest / query / node / status
    └── ui/               # TUI (Ink + React)
```

## 5. 已实现

- ✅ brainstorm → 逐条确认(a/s/m/a all) → compile → wiki
- ✅ m 模式 reread（最多 3 次），m 后选原版/修订版
- ✅ 反直觉标注在 proposition 内，compile 后自动汇总
- ✅ index.md + log.md 自动生成
- ✅ cross-page update 管道（findRelatedPages → updatedPages → gate 确认）
- ✅ TUI + CLI 双入口
- ✅ 四层前缀缓存（brainstorm/compile 共享 system prompt）
- ✅ MD / LaTeX 双格式入口
- ✅ **TeX 文件夹导入** — `ingest ./folder/` 自动找主 `.tex`，解析 `\input{}` 拼接，Pro 清洗
- ✅ **--thread all|N** — 跳过主线选择交互，适配脚本和非交互场景
- ✅ **.bbl 模糊匹配** — 找不到指定 `.bbl` 时自动使用同目录其他 `.bbl`
- ✅ **缺失子文件 warn** — `\input{xxx}` 找不到时 console.warn，不静默丢失
- ✅ **递归深度上限** — `\input{}` 嵌套超 10 层抛错，防栈溢出
- ✅ **TEX_CLEAN_PROMPT** — 支持 theorem/lemma/proof、thanks、itemize/enumerate
- ✅ 模型: deepseek-v4-pro

## 6. 待做

- [ ] compile 篇幅控制（短文档输出过短）
- [ ] `--auto` 非交互模式
- [ ] `--resume` 中断恢复
- [ ] 出口 agent（wiki 可直接被 Codex 等 agent 使用，数量不够时不需要专属出口）

## 7. 不做

- SQLite 图谱 —— 文件系统 grep 足够
- Flash Compiler —— Pro 一步走通
- entities/ 目录分离 —— 无必要
- Marker/OCR PDF —— 太重
- PDF 清洗 —— 暂关入口，逻辑保留
