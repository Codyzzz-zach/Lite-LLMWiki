# E2E Baseline — 2026-06-10 (优化后)

> 测试文件：`raw/original/pdf/e的基本画像.pdf`
> 管线：`raw → chase → wiki → audit → search → query`
> 基于 2026-06-09 baseline 的优化结果

---

## 一、优化后量化测试记录

| 阶段 | 命令 | exit code | ok | 关键指标 | vs 优化前 |
|------|------|-----------|-----|----------|----------|
| Build | `npm run build` | 0 | — | tsup ESM, 33ms | ≈ |
| Structure Audit | `audit --json` | 0 | ✅ | nodes=22, verified=22, missingEvidence=0, coverage=1 | = |
| Semantic Audit | `audit --semantic --json` | **0** | **✅** | passed=13, warning=9, failed=**0**, avg=**0.94** | exit 2→0, failed 1→0, avg 0.93→0.94 |
| Audit Gate | `wiki/audit-gate.json` | — | ✅ | structureOk=true, semanticOk=true | **新增** |
| Search | `search "1/e" --json --max 5` | 0 | — | matches=5, top score=13.5 | = |
| Query (中文) | `query "秘书问题的1/e法则" --mode ask --json` | 0 | ✅ | seedNodes=**5**, fromWiki=**5**, LLM answer=**生成** | seedNodes 0→5, answer board-only→LLM |
| Query (英文) | `query "what is 1/e" --mode ask --json` | 0 | ✅ | seedNodes=5, fromWiki=5, LLM answer=生成 | seedNodes 0→5 |
| Inspire | `inspire --seed "1/e" --json` | 0 | ✅ | seed=1-e-overview, connections/questions=heuristic | board-only→LLM (key存在时) |
| Audit Gate Block | gate=failed → query | **2** | ❌ | "structure audit failed — spec 11.2" | **新增** |
| Ingest Failure | `ingest /nonexistent --json` | 1 | ❌ | spec 11.3 JSON: ok=false, stage=ingest | stderr→JSON |
| Unit Tests | `npm run test` | 0 | — | 229 passed / 19 files | = |
| TypeCheck | `npm run typecheck` | 0 | — | pass | = |

---

## 二、修复清单与代码变更

### A. 实操确认缺陷修复（5/5）

| # | 缺陷 | 修复方式 | 文件 |
|---|------|---------|------|
| A1 | `audit --semantic` 不注入 llmJudge | 提取 `cli-llm-init.ts` → `tryMakeLlmJudge()` | `audit.ts`, `cli-llm-init.ts` |
| A2 | `semantic-audit.ts` 动态 `require("node:fs")` | 改用顶部已 import 的 `readdirSync` | `semantic-audit.ts:286` |
| A3 | `query` 不注入 llmCaller | `tryMakeLlmCaller()` → 签名适配 | `query.ts`, `cli-llm-init.ts` |
| A4 | ingest 失败不输出 spec 11.3 JSON | catch 块输出 `{ok:false, stage, error, blockingIssues, suggestedNextActions}` | `ingest.ts:73-88` |
| A5 | 中文 query seedNodes=0 | `Intl.Segmenter("zh-CN")` + 数学表达式保留 | `search.ts:150-193` |

### B. 潜在缺陷修复（2/4）

| # | 缺陷 | 修复方式 | 文件 |
|---|------|---------|------|
| B1 | audit gate 无持久化 | `audit-gate.ts`: writeAuditGate + checkAuditGate, query/inspire 启动时检查 | `audit-gate.ts`, `query.ts`, `inspire.ts`, `audit.ts` |
| B2 | inspire 不注入 llmCaller | `tryMakeLlmCaller()` → 签名适配 | `inspire.ts` |

### C. 未修复项（2）

| # | 缺陷 | 原因 |
|---|------|------|
| B3 | search BM25 声称 vs 实际 | 低优先级，当前 keyword×weight 对英文/中文均可用，改 BM25 需调参 |
| B4 | conservative 策略 claim 拉伸 | v5 known gap，需从 compile prompt 层面解决 |

---

## 三、新增文件

| 文件 | 职责 |
|------|------|
| `src/cli/cli-llm-init.ts` | CLI 共享 LLM 初始化：`tryMakeLlmJudge()`, `tryMakeLlmCaller()` |
| `src/knowledge/audit-gate.ts` | 审计关卡：`writeAuditGate()`, `checkAuditGate()`, `wiki/audit-gate.json` |

---

## 四、关键设计决策

### 4.1 CLI 共享 LLM 初始化（替代方案 A 的逐命令复制）

```typescript
// cli-llm-init.ts
export function tryMakeLlmJudge(config): ((prompt: string) => Promise<string>) | null
export function tryMakeLlmCaller(config): ((board, question) => Promise<{answer, usage}>) | null
```

- 两个函数封装了 `loadApiKey() → DeepSeekClient → 注入函数` 的完整路径
- 返回 null 表示无 key（走 board-only / spec 7.7 failure path）
- 新命令只需 import + 一行调用

### 4.2 中文分词（Intl.Segmenter + 数学 token 保留）

```
query: "秘书问题的1/e法则是什么"
Step 1: MATH_TOKEN_RE 提取 "1/e"
Step 2: Intl.Segmenter 分词 "秘书问题的 / 法则是什么"
         → ["秘书", "问题", "的", "法则", "是", "什么"]
         → 过滤 MIN_KEYWORD_LENGTH > 1 → ["秘书", "问题", "法则"]
Step 3: 合并 → ["秘书", "问题", "法则", "1/e"]
```

- `Intl.Segmenter("zh-CN", {granularity: "word"})` 是 Node 22 内置 Web 标准，零依赖
- 数学表达式 `MATH_TOKEN_RE = /[0-9]+[\/\\^][a-zA-Z0-9{}()\[\]+\-]+|[0-9]+\.?[0-9]*%/g` 在分词前提取，保留整体

### 4.3 Audit Gate（spec 11.2 跨进程保护）

```
audit --json → writeAuditGate(config, structureOk, semanticOk, nodes, score)
                                    → wiki/audit-gate.json

query/inspire → checkAuditGate(config)
  → gate.passed=false → 输出 spec 11.3 failure JSON, exit 2
  → gate.passed=true + gate.warning → stderr 警告，继续执行
```

- `audit-gate.json` 是轻量 JSON（6 个字段），每次 audit 自动更新
- query/inspire 启动时先检查，audit 失败则阻止查询

---

## 五、Spec vs 实现对照（优化后）

| spec 要求 | 优化前 | 优化后 |
|-----------|--------|--------|
| 11.2 audit 失败后禁止 query | ❌ 无 gate | ✅ audit-gate.json 跨进程 gate |
| 7.7 API key 缺失 → ok:false | ❌ 永远报 no-llm-judge | ✅ tryMakeLlmJudge 从 .env 读取 |
| 9.2 query 输出 fromWiki/modelSynthesis/missingEvidence | ❌ 永远空 | ✅ LLM caller 注入，三层分解输出 |
| 11.3 核心命令失败返回 JSON | ❌ ingest stderr | ✅ ingest catch 输出 spec 11.3 JSON |
| 8.3 中文 query seed 命中 | ❌ 0 seedNodes | ✅ Intl.Segmenter 分词，5 seedNodes |

---

## 六、量化改进对比

| 指标 | 优化前 | 优化后 | 变化 |
|------|--------|--------|------|
| semantic audit exit code | 2 | 0 | ✅ |
| semantic audit failed nodes | 1 | 0 | ✅ |
| semantic audit avg score | 0.93 | 0.94 | +0.01 |
| 中文 query seedNodes | 0 | 5 | +5 |
| 中文 query fromWiki | 0 | 5 | +5 |
| query answer | board-only 占位符 | LLM 综合 | ✅ |
| audit gate | 无 | 跨进程 JSON gate | ✅ |
| ingest 失败输出 | stderr | spec 11.3 JSON | ✅ |
| unit tests | 229 pass | 229 pass | = |
