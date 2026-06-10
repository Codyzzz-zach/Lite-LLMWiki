# E2E Baseline — 2026-06-09

> 测试文件：`raw/original/pdf/e的基本画像.pdf`
> 管线：`raw → chase → wiki → audit → search → query`

---

## 一、量化测试记录

| 阶段 | 命令 | exit code | ok | 关键指标 |
|------|------|-----------|-----|----------|
| Build | `npm run build` | 0 | — | tsup ESM, 28ms |
| Ingest | `ingest "e的基本画像.pdf" --auto --policy conservative --json` | 1 | ❌ | MinerU 解析 ~113s; chase 4 chunks 35KB; wiki 23 nodes generated; auto-audit fetch failed |
| Structure Audit | `audit --json` | 0 | ✅ | nodes=22, verifiedNodes=22, missingEvidence=0, invalidChunkRefs=0, coverage=1 |
| Semantic Audit | `audit --semantic --json` | 2 | ❌ | nodes=22, passed=15, warning=6, failed=1, averageScore=0.93 |
| Search | `search "1/e" --json --max 10` | 0 | — | matches=10, top score=13.5, all auditStatus=passed |
| Query (ask) | `query "秘书问题的1/e法则是什么" --mode ask --json` | 0 | ✅ | seedNodes=0, evidenceNodes=0, counterNodes=2, gaps=1, answer="board-only" |
| Unit Tests | `npm run test` | 0 | — | 229 passed / 19 files |
| TypeCheck | `npm run typecheck` | 0 | — | pass |

### Semantic Audit 详细

| 维度 | warning | failed | 问题节点 |
|------|---------|--------|----------|
| support | 2 | 0 | concept/1-e-overview (stretched) |
| addition | 1 | 0 | concept/1-e-overview (子模优化 not in source) |
| inference | 0 | 0 | — |
| limits | 1 | 0 | — |
| citation | 2 | 1 | concept/1-e-overview (claim 含源文未直接提及内容) |

### Wiki 节点产出

| kind | count | 来自 e的基本画像 | 来自 2601.07372v1 |
|------|-------|-----------------|------------------|
| concept | 7 | 6 | 1 |
| method | 7 | 3 | 4 |
| insight | 6 | 0 | 6 |
| claim | 1 | 0 | 1 |
| counter | 2 | 1 | 1 |
| **total** | **23** | **10** | **13** |

### Ingest 管线时间分布（估算）

| 阶段 | 耗时 | 说明 |
|------|------|------|
| MinerU PDF parse | ~113s | API 调用，含等待 |
| Chase 写入 | <1s | 4 chunks, 35KB |
| Pro Ingest (extract) | ~5-10s | DeepSeek API |
| Pro Ingest (reread) | ~5-10s | DeepSeek API |
| Pro Ingest (compile) | ~5-10s | DeepSeek API |
| Auto audit (structure) | <1s | 纯本地 |
| Auto audit (semantic) | 失败 | fetch failed |

---

## 二、Spec vs 实现对照分析

### 2.1 Agent Contract (spec 11.x)

| spec 要求 | 实现状态 | 偏差 |
|-----------|---------|------|
| 11.1 标准流程: plan→ingest→audit→semantic→query/inspire | ⚠️ 部分 | plan 命令存在但本次未跑；semantic 在 ingest auto 内触发但未独立验证 |
| 11.2 audit 失败后禁止 query | ❌ 未实现 | `audit --semantic` 返回 `ok:false` 后 query 仍可执行且返回 `ok:true`；无 gate 机制 |
| 11.3 失败返回含 stage/error/blockingIssues/suggestedNextActions | ✅ 实现 | ingest 的 fetch failed 未走此契约（exit code 1 无 JSON） |
| 11.4 Agent Helper 更新 | ✅ 已有 | helper.zh.md / helper.md 内容与 spec 对齐 |

**关键偏差**：spec 11.2 明确要求 "在 audit 失败后把 wiki 当可靠来源" 是禁止行为，但代码层面没有 gate。CLI 层面 `audit --semantic` exit code 2 只是退出当前进程，不阻止后续独立调用 `query`。

### 2.2 Audit (spec 7.x)

| spec 要求 | 实现状态 | 偏差 |
|-----------|---------|------|
| 7.2 五维度审查 (support/addition/inference/limits/citation) | ✅ 实现 | LLM prompt 含五维度 |
| 7.3 输出含 suggestedFix | ⚠️ 部分 | JSON schema 定义了但实测输出中大部分 issue 缺 suggestedFix |
| 7.4 CLI: `audit --semantic --source <id>` | ✅ 实现 | — |
| 7.7 API key 缺失 → `ok:false, stage=semantic-audit` | ❌ Bug (已修) | 原代码 registerAuditCommand 不注入 llmJudge，永远返回 "no LLM judge" |
| 7.8 默认不写回 wiki | ✅ 实现 | 但有 writeSemanticAuditResults 调用 |

### 2.3 Ingest (spec 5.x / 10.1)

| spec 要求 | 实现状态 | 偏差 |
|-----------|---------|------|
| `--auto --policy conservative --json` | ✅ 实现 | — |
| `--audit` / `--audit semantic` 选项 | ❌ 未实现 | spec 10.1 定义了 `--audit` 和 `--audit semantic` 作为显式选项，实际 ingest 命令无此选项，auto 模式下硬编码触发 |
| ingest 失败返回 spec 11.3 契约 | ❌ 未实现 | ingest 的 fetch failed 直接 stderr + exit code 1，不输出 JSON |

### 2.4 Query Board (spec 8.x)

| spec 要求 | 实现状态 | 偏差 |
|-----------|---------|------|
| 8.1 board 是确定性装配 | ✅ 实现 | buildQueryBoard 不调 LLM |
| 8.3 ask 模式：top relevant + claim/evidence/limits | ⚠️ 部分 | seed 依赖 searchWiki 匹配，中文查询命中率低 |
| 8.7 SearchMatchV6 扩展字段 | ✅ 实现 | — |
| 9.1 输出 fromWiki/modelSynthesis/missingEvidence 分层 | ⚠️ 部分 | modelSynthesis 始终为空（无 llmCaller 注入） |
| 9.2 "回答可以自由，但输出必须可分解" | ❌ 未实现 | 无 LLM 调用，answer 永远是 board-only 占位符 |
| spec 12.3 prompt 构造 | ⚠️ 部分 | QUERY_SYSTEM_PROMPT 存在，makeDeepSeekCaller 工厂存在，但 CLI 层不注入 |

### 2.5 Search (spec 8.7)

| spec 要求 | 实现状态 | 偏差 |
|-----------|---------|------|
| BM25 评分 | ❌ 简化 | 实现为 keyword-includes × field-weight，非 BM25 |
| 排除 auditStatus=failed | ✅ 实现 | 默认排除，`--include-failed` 可覆盖 |

---

## 三、缺陷分析

### A. 本次实操确认的缺陷（5 个）

| # | 缺陷 | 严重度 | 影响 | 根因 |
|---|------|--------|------|------|
| A1 | `audit --semantic` 不注入 llmJudge | **Critical** | semantic audit 对 CLI 用户完全不可用 | registerAuditCommand 缺少 DeepSeekClient 构造 |
| A2 | `semantic-audit.ts:286` 动态 `require("node:fs")` | **Critical** | ESM bundle 下 semantic audit 必崩 | 顶部已有 import，函数体内重复 require |
| A3 | `query` 命令不注入 llmCaller | **Critical** | query 永远返回 board-only 占位符，无 LLM 综合 | registerQueryCommand 缺少 makeDeepSeekCaller 注入 |
| A4 | ingest 自动 audit 失败后 exit code 1 但无 JSON | **Medium** | agent 无法解析失败原因，违反 spec 11.3 | catch 块不输出 JSON，直接 stderr |
| A5 | query board 中文查询 seedNodes=0 | **Medium** | 中文用户 query 几乎不可用 | searchWiki 用 keyword includes，中文分词差 |

### B. 可能存在的潜在缺陷（4 个）

| # | 潜在缺陷 | 严重度 | 推测依据 |
|---|---------|--------|---------|
| B1 | audit gate 无持久化 | **High** | spec 11.2 要求 "audit 失败后禁止 query"，但当前只在进程内 exit code 2，无跨进程 gate。agent 可直接调 query 绕过 |
| B2 | inspire 命令不注入 llmCaller | **High** | ✅ 已确认：registerInspireCommand 无 makeDeepSeekCaller，heuristic fallback 仅基于 tag/source 共享 |
| B3 | search BM25 声称 vs 实际不符 | **Low** | helper 文档和 spec 说 BM25，实际是简单 keyword×weight |
| B4 | conservative 策略 claim 拉伸 | **Medium** | 1-e-overview claim 含源文未提及的"子模优化"，semantic audit 标记 addition/stretched |

---

## 四、架构问题根因分析

### 4.1 为什么三个命令都缺少 LLM 注入？

**直接原因**：`registerXxxCommand` 的 `.action()` 回调里，`options` 从 Commander 解析直接透传给 `runXxxCli`，没有"CLI 包装层"负责环境初始化。

**深层原因**：代码架构存在 **两层分离的设计意图**，但只有一层被完成：

```
设计意图（从 engine.ts 注释可见）:
┌─────────────────────────┐     ┌──────────────────────────┐
│  CLI 包装层              │     │  核心逻辑层               │
│  (registerXxxCommand)   │     │  (runXxxCli / engine)    │
│                         │     │                          │
│  职责:                   │     │  职责:                    │
│  - 读 .env / API key    │     │  - 纯业务逻辑             │
│  - 构造 DeepSeekClient  │     │  - llmCaller/llmJudge 注入│
│  - 注入 llmCaller       │     │  - 可测试（mock 注入）     │
└─────────────────────────┘     └──────────────────────────┘

实际状态:
┌─────────────────────────┐     ┌──────────────────────────┐
│  CLI 包装层              │     │  核心逻辑层               │
│                         │     │                          │
│  ingest: ✅ 完整         │     │  engine: ✅ 可注入        │
│    (有 client 构造)      │     │  audit:  ✅ 可注入        │
│  audit:  ❌ 缺失         │     │  query:  ✅ 可注入        │
│  query:  ❌ 缺失         │     │  inspire: ✅ 可注入       │
│  inspire: ❌ 疑似缺失    │     │                          │
└─────────────────────────┘     └──────────────────────────┘
```

核心逻辑层设计得很好（`llmJudge`/`llmCaller` 可注入），但 CLI 包装层只有 `ingest` 做完了。`audit`、`query`、`inspire` 的 CLI 包装都是骨架代码，缺少"读 key → 构造 client → 注入"这一步。

### 4.2 为什么中文 query 命中率低？

```
search "1/e" → 10 matches (BM25-like: keyword "1/e" 命中 title/tags/claim)
query "秘书问题的1/e法则" → 0 seed nodes

差异根因:
search 的 extractKeywords("1/e") → ["1", "e"] → includes 匹配
query 的 extractKeywords("秘书问题的1/e法则是什么") → 
  split by 空格/标点 → ["秘书问题的1", "e法则是什么"]
  → 任何 node 的 title/claim/tags 都不含这些 token
```

中文没有空格分词。`searchWiki` 的 `extractKeywords` 用 `split(/[\s,，。？、...]+/)` 对中文无效——中文整句被当成一个 token。

### 4.3 为什么 ingest 失败不输出 spec 11.3 JSON？

```typescript
// ingest.ts:549
} catch {
  out("  🔍  audit: structure passed, semantic skipped (API error)");
}
```

catch 块吃掉了错误，只输出人类可读的 stderr，没有输出 JSON 格式的 failure shape。这违反了 spec 11.3 的 "所有核心命令失败必须返回 ok:false + stage + error"。

---

## 五、修复方案分析

### 方案 A：补全 CLI 包装层（最小侵入）

**做法**：在 `registerAuditCommand`、`registerQueryCommand`、`registerInspireCommand` 里各加 `loadApiKey() + DeepSeekClient` 构造 + 注入，与 `ingest` 保持一致。

**优点**：
- 最小代码变动（~15 行/命令）
- 不影响核心逻辑层
- 与现有 ingest 模式一致

**风险**：
- 三个命令重复同样的"读 key → 构造 client → 注入"模式，未来新增命令也需复制
- 没有解决 ingest catch 块不输出 JSON 的问题
- 没有解决 audit gate 跨进程的问题

### 方案 B：提取 CLI 共享初始化层 + 修复 JSON 契约

**做法**：
1. 提取 `withLlmCaller(config, options, handler)` 高阶函数，统一处理 key 读取 + client 构造 + 注入
2. 修复 ingest 的 catch 块：输出 spec 11.3 JSON failure shape
3. 在 `wiki/index.json` 里记录 `lastAuditStatus`，query/inspire 启动时检查

**优点**：
- 消除重复，新命令自动获得 LLM 注入
- 修复 spec 11.3 契约
- 部分 audit gate 实现（进程级）

**风险**：
- `lastAuditStatus` 写入增加 wiki index 的职责
- 进程级 gate 不是 spec 11.2 要求的跨进程 gate
- 中等代码量（~80 行新增/修改）

### 方案 C：中文分词 + 上述所有修复

**做法**：在方案 B 基础上，引入 `Intl.Segmenter` (Node 22 内置) 对中文 query 做分词。

**优点**：
- 根治中文 query 命中率问题
- `Intl.Segmenter` 是 Web 标准，零依赖

**风险**：
- `Intl.Segmenter` 分词质量不如 jieba，对专业术语（"1/e"、"子模"）可能不好
- 影响范围大（search + query board 的 seed 搜索都受影响）
- 需要调整 minScore 和字段权重

---

## 六、方案对比

| 维度 | 方案 A | 方案 B | 方案 C |
|------|--------|--------|--------|
| 修复 A1 (audit 无 llmJudge) | ✅ | ✅ | ✅ |
| 修复 A2 (require fs) | ✅ (已修) | ✅ | ✅ |
| 修复 A3 (query 无 llmCaller) | ✅ | ✅ | ✅ |
| 修复 A4 (ingest 不输出 JSON) | ❌ | ✅ | ✅ |
| 修复 A5 (中文 query 命中率) | ❌ | ❌ | ✅ |
| 修复 B1 (audit gate 持久化) | ❌ | ⚠️ 进程级 | ⚠️ 进程级 |
| 修复 B2 (inspire 无 llmCaller) | ✅ | ✅ | ✅ |
| 代码量 | ~45 行 | ~120 行 | ~180 行 |
| 引入新依赖 | 无 | 无 | 无 (Intl.Segmenter 内置) |
| 影响范围 | 3 个 CLI 命令 | 3 CLI + ingest + index | 全部 + search |
| 回归风险 | 低 | 中 | 中-高 |
