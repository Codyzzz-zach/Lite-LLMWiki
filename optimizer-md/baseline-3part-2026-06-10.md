# LiteWikiagent 3-Part Baseline — 2026-06-10 v2

> 测试文件：`raw/original/pdf/e的基本画像.pdf`
> 分段模型：`Part1: raw→chase | Part2: chase→wiki | Part3: wiki→answer`

---

## Part 1: raw → raw/chase（加载 + 分块 + 写入 chase）

> MinerU 速度不重要，本产品偏向 md/tex。Part 1 不再是优化重点。

### 代码边界

| 入口 | 文件 | LLM? | 说明 |
|------|------|------|------|
| `loadFromFile()` | `src/ingest/loader.ts:120` | ❌ | Markdown: readFileSync → chunkText |
| `loadFromPdf()` | `src/ingest/pdf-loader.ts:38` | ❌ | PDF: MinerU Agent API → Markdown → chunkText |
| `loadFromTex()` | `src/ingest/tex-loader.ts:86` | ⚠️ 可选 | TeX: resolveIncludes → DeepSeek 清洗（无 key 时 fallback 原始 TeX） |
| `chunkText()` | `src/ingest/loader.ts:74` | ❌ | 按段落分块，target=2000 tok，overlap=200 tok |
| `saveRaw()` | `src/knowledge/store.ts:32` | ❌ | 写入 chase: frontmatter + chunk markers |

### 量化指标

| 指标 | 值 |
|------|-----|
| chase 文件 | 836 行 / 35KB |
| chunks 数 | 4 |
| LLM 调用 | 0（PDF 不需要） |

### 已知问题

| # | 问题 | 严重度 |
|---|------|--------|
| P1-1 | chunk 边界粗糙（可能在数学推导中间断开） | Medium |
| P1-2 | TeX 清洗依赖 LLM，无 key 时质量差 | Low |

---

## Part 2: raw/chase → wiki（提取 → 编译 → 审计）

### 代码边界

| 步骤 | 入口 | LLM 调用 | 输出 |
|------|------|---------|------|
| **extract** | `proIngest({mode:"extract"})` | Pro Think(8K) → Flash Format(16K) | threads[] + propositions[] |
| **reread** | `proIngest({mode:"reread"})` | Flash 单步(4K) | 修订 proposition（交互模式） |
| **compile** | `proIngest({mode:"compile"})` | Pro Think(8K) → Flash Format(32K) | nodeDrafts[] + updatedPages[] |
| **policy** | `filterByPolicy("conservative")` | ❌ | 确认/跳过 propositions |
| **render** | `renderWikiNode(draft)` | ❌ | frontmatter + body → .md |
| **counter** | `buildCounterNode()` | ❌ | 聚合反直觉 propositions |
| **struct audit** | `auditWiki()` | ❌ | 验证 nodeId/sourceIds/chunkRefs/evidence |
| **semantic audit** | `runSemanticAudit()` | 逐节点 LLM judge | 5维度 faithfulness 评分 |

### 量化指标

#### 节点产出

| kind | 总数 | 来自 e的基本画像 | 来自 2601.07372v1 |
|------|------|-----------------|------------------|
| concept | 7 | 6 | 1 |
| method | 7 | 3 | 4 |
| insight | 6 | 0 | 6 |
| claim | 1 | 0 | 1 |
| counter | 2 | 1 | 1 |
| **total** | **23** | **10** | **13** |

#### 字段完整率

| 字段 | 非空节点 / 总节点 | 完整率 | 空 |
|------|-----------------|--------|-----|
| Claim | 23 / 23 | 100% | 0 |
| Evidence | 23 / 23 | 100% | 0 |
| Interpretation | 23 / 23 | 100% | 0 |
| Limits | 23 / 23 | 100% | 0 |
| Use For | 23 / 23 | 100% | 0 |

#### 审计结果

| 节点 | auditStatus | auditScore |
|------|------------|-----------|
| 21/23 | passed | (未写入分数) |
| 1/23 (engram-long-context-superiority) | **pending** | — |
| 1/23 (1-e-overview semantic warning) | passed | — |

**auditScore 全部为空** — semantic audit 的分数未写回 frontmatter。

#### LLM 调用成本

| 步骤 | 调用次数 | 估算 token | 实测 token |
|------|---------|-----------|-----------|
| extract Think | 1 | ~8K | **未记录** |
| extract Format | 1 | ~16K | **未记录** |
| compile Think | 1 | ~8K | **未记录** |
| compile Format | 1 | ~32K | **未记录** |
| semantic audit | 22 | ~22×1K | **未记录** |
| **合计** | **~26** | **~86K** | **缺失** |

### 已知问题

| # | 问题 | 严重度 | 影响 |
|---|------|--------|------|
| P2-1 | **ingest auto-audit 不写 audit-gate.json** | **Critical** | Part 2 完成后 Part 3 的 gate 可能过时，query 可绕过审计 |
| P2-2 | auditScore 未写回 wiki frontmatter | High | 语义审计分数丢失，Part 3 无法按分数过滤 |
| P2-3 | LLM token 用量未汇总输出 | Medium | 无法评估 Part 2 成本 |
| P2-4 | conservative 策略 claim 拉伸 | Medium | 1-e-overview 含源文未提及的"子模优化" |
| P2-5 | 1 个节点 auditStatus=pending | Low | engram-long-context-superiority 未通过审计 |

### 缺失指标

| 指标 | 如何获取 |
|------|---------|
| propositions 提取/确认/跳过数量 | 在 runIngestPipeline 中加计数并输出到 JSON |
| 各 LLM 步骤 token 用量 | 在 DeepSeekClient.chat 返回后记录 usage |
| compile 生成字段质量评分 | 统计各 section 的信息密度（非空行数/总行数） |

---

## Part 3: wiki → answer（搜索 → 查询 → 灵感）

### 代码边界

| 步骤 | 入口 | LLM? | 说明 |
|------|------|------|------|
| **audit gate** | `checkAuditGate()` | ❌ | 读 audit-gate.json，决定放行/阻止 |
| **search** | `searchWiki()` | ❌ | keyword×field-weight + Intl.Segmenter 中文分词 |
| **board** | `buildQueryBoard()` | ❌ | 确定性 6-mode 装配，不调 LLM |
| **LLM answer** | `queryKnowledge()` via llmCaller | ✅ | DeepSeek chat 综合回答 |
| **inspire** | `runInspireCli()` via llmCaller | ✅ | DeepSeek chat 生成 connections/hypotheses |

### 量化指标

#### 搜索召回

| 查询词 | matches 数 |
|--------|-----------|
| 1/e | 11 |
| 秘书问题 | 7 |
| 指数衰减 | 5 |
| 子模 | 4 |
| 贪心算法 | 4 |
| 信息熵 | 4 |
| 伯努利 | 3 |
| 错位排列 | 1 |

#### Query board 命中

| 查询 | seedNodes | fromWiki | missingEvidence |
|------|-----------|----------|-----------------|
| 1/e是什么 | 5 | 5 | 0 |
| 秘书问题的1/e法则 | 5 | 5 | 0 |
| 指数衰减的1/e寿命 | 5 | 5 | 0 |
| 伯努利试验全失败概率 | 5 | 5 | 0 |
| 子模最大化贪心近似比 | 4 | 4 | 0 |
| 错位排列概率极限 | 5 | 5 | 0 |
| 信息熵峰值在哪里 | 5 | 5 | 0 |

**7/7 查询全部命中**，seedNodes 4-5，missingEvidence=0。

#### LLM 回答质量

| 查询 | fromWiki 节点 | answer 质量判定 |
|------|-------------|----------------|
| 秘书问题的1/e法则 | 5 个 | ❌ **LLM 说"没有提供 seedNodes"，完全忽略 board 数据** |
| 伯努利试验全失败概率 | 5 个 | ❌ **同上，LLM 自行推断而非引用 wiki** |
| 信息熵峰值在哪里 | 5 个 | ❌ **同上，LLM 请求提供 board** |

### 🔴 Part 3 核心问题：LLM 没有收到 board

```
makeDeepSeekCaller (engine.ts:205):
  async (_board: QueryBoard, question: string) => {
    client.chat({
      systemPrompt: QUERY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: question }],  // ← 只传了 question！
    })
  }
```

**`_board` 参数被完全忽略**。LLM 只收到 question，不知道 wiki 里有什么内容。
这导致：
1. LLM 不知道 fromWiki 有哪些 claim 可引用
2. LLM 不知道 board 里有哪些 seedNodes/evidenceNodes
3. LLM 无法区分 fromWiki / modelSynthesis / missingEvidence
4. 即使 fromWiki 有 5 个节点，answer 也说"没有数据"

**影响**：整个 Part 3 的 LLM 综合功能**名存实亡**。query 和 inspire 的 LLM 输出都是无根推断。

### 其他 Part 3 问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| P3-1 | **LLM 未收到 board 数据** | **Critical** | makeDeepSeekCaller 忽略 board 参数，只传 question |
| P3-2 | modelSynthesis 始终为空 | High | LLM 无法返回结构化 fromWiki/modelSynthesis/missingEvidence |
| P3-3 | search 不是 BM25 | Low | keyword×weight 简化版，spec 声称 BM25 |
| P3-4 | audit gate 对 search 无约束 | Low | search 不检查 gate |
| P3-5 | audit gate 对 inspire 缺少写入口 | Medium | ingest auto-audit 不写 audit-gate.json（同 P2-1） |

---

## 跨 Part 问题

| # | 问题 | 涉及 Part | 说明 |
|---|------|----------|------|
| X-1 | ingest auto-audit 不写 audit-gate.json | P2→P3 | Part 2 完成后 Part 3 的 gate 过时 |
| X-2 | auditScore 未写回 wiki | P2 | 语义分数丢失 |
| X-3 | LLM token 用量无汇总 | P2+P3 | 无法评估全流程成本 |
| X-4 | chunk 边界影响 Part 2 质量 | P1→P2 | 分块在推导中间断开 |

---

## 优先级排序（按对产品质量的影响）

| 优先级 | 问题 | Part | 修复估算 |
|--------|------|------|---------|
| **P0** | P3-1: LLM 未收到 board 数据 | Part 3 | ~50 行（序列化 board → user message） |
| **P0** | P2-1: ingest auto-audit 不写 audit-gate.json | Part 2→3 | ~5 行（ingest auto-audit 后调 writeAuditGate） |
| **P1** | P2-2: auditScore 未写回 wiki | Part 2 | ~10 行（semantic audit 写回逻辑修复） |
| **P1** | P3-2: modelSynthesis 始终为空 | Part 3 | 随 P3-1 一起修（LLM 收到 board 后可返回结构化输出） |
| **P2** | X-2: LLM token 用量无汇总 | 跨 Part | ~30 行（各步骤记录 usage 并汇总到 JSON） |
| **P2** | P2-4: conservative claim 拉伸 | Part 2 | compile prompt 层面优化 |
