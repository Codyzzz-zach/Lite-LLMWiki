## LiteWikiagent 项目审查报告

日期: 2026-06-15

---

### 一、项目概况

LiteWikiagent 是一个 agent-first 的个人知识编译器，TypeScript CLI（约 2500+ 行源码，20 个测试文件），核心流程为 `raw → chase → wiki → audit → query/inspire`。经历了 v2.2 到 v6.0 共 8+ 个设计版本迭代，当前以 v6.0 spec 为指导。

项目整体架构清晰、文档详尽、测试覆盖较广。但在设计文档与代码实现之间，以及代码内部，存在若干值得关注的矛盾和不一致。

---

### 二、设计架构与代码实现的矛盾

#### 2.1 modelSynthesis 输出分层——"名存实亡"

**Spec 要求（v6.0 §9.1-9.2）**：Query 输出必须分解为 `fromWiki`（来自 wiki 的内容）、`modelSynthesis`（模型基于 wiki 的综合，需标明 `basedOn` 节点和 `confidence`）、`missingEvidence`（wiki 暂无依据的部分）。

**代码实现**（`engine.ts` L372-378）：`makeDeepSeekCaller` 把 LLM 的**整个回答**作为一个 `modelSynthesis` 条目返回，`basedOn` 设为全部 seed node IDs，`confidence` 固定 `"medium"`。

```typescript
const modelSynthesis = board.seedNodes.length > 0
  ? [{
      text: result.content,        // ← 整个 LLM 回答原封不动
      basedOn: board.seedNodes.map((n) => n.nodeId),  // ← 所有 seed
      confidence: "medium" as const,
    }]
  : [];
```

**矛盾本质**：Spec 要求的是 LLM 自己把推理部分拆成若干带锚点的条目，但代码把整段回答当作一条 synthesis。这使得 `fromWiki` 和 `modelSynthesis` 之间的分层形同虚设——用户和 agent 无法区分哪些来自 wiki，哪些是模型新推理。这是 v6 产品哲学的核心矛盾。

---

#### 2.2 boardRoles 字段——定义了但从未生成

**Spec 要求（v6.0 §6.1-6.2）**：每个 wiki 节点应有 `boardRoles` 字段，表示该节点在 query board 中可扮演的角色（`evidence | concept | method | case | limit | counter | question | anchor | bridge`），用于上下文装配时按用途筛选。

**代码实现**：
- `types.ts` 中 `WikiFrontmatter.boardRoles` 定义为 `BoardRole[]`（正确）
- `render.ts` 会渲染 `boardRoles`（如果 draft 提供的话）
- `board.ts` 的 `matchToBoardNode` 始终写死 `boardRoles: []`
- 实际 wiki 产物中**所有 5 个节点都没有 `boardRoles` 字段**
- ingest pipeline 没有任何逻辑生成 `boardRoles`

**矛盾本质**：Spec 设计了一个按角色装配的机制，但代码从未产生过角色数据。Board builder 当前只按 `kind` 和 `tags` 筛选节点，`boardRoles` 从未参与装配逻辑。

---

#### 2.3 claimType 和 inferenceLevel——定义但未使用

**Spec 要求（v6.0 §6.2）**：`claimType` 区分节点主张性质（`source_claim | interpretation | application | analogy | question | counter`），`inferenceLevel` 表示推理距离（`none | light | medium | strong`）。

**代码实现**：类型定义存在，renderer 能写出这两个字段，但 ingest pipeline 的 compile prompt 没有要求 LLM 输出这两个字段，实际产物中也没有它们。Board builder 不读取也不使用这两个字段。

**矛盾本质**：Spec 认为这两个字段对 board 装配至关重要（"帮助 board setup 正确摆局"），但代码中它们完全是死代码。

---

#### 2.4 compare 模式——有壳无肉

**Spec 要求（v6.0 §8.6）**：compare 是专门的比较局面，应装配两组或多组 seed nodes，展示各自 claim/evidence/limits、shared tags、bridge nodes、contradiction/tension candidates。

**代码实现**（`board.ts` L234-242）：
```typescript
case "compare": {
  const evidenceNodes = pickEvidence(seeds, allBoardNodes, seedIds, 5);
  const relatedNodes = pickBridgeNodes(seeds, allBoardNodes, seedIds);
  const limitNodes = seeds.filter((n) => n.limits.length > 0);
  const counterNodes: BoardNode[] = [];
  const questionNodes: BoardNode[] = [];
  return { seedNodes: seeds, evidenceNodes, relatedNodes, limitNodes, counterNodes, questionNodes, tensionNodes: [] };
}
```

**矛盾本质**：没有按 `sourceId` 实际分组形成多组对比结构，也没有识别 contradiction/tension candidates。`findSeedNodes` 中 `compare` 分支只有空注释（`// 已经过滤过；保留所有`）。compare 模式的装配逻辑与 ask 模式几乎无区别。

---

#### 2.5 gaps 构建——实质为空

**Spec 要求（v6.0 §8）**：Board 应识别知识缺口（gaps），每个 gap 包含 `question` 和 `reason`，驱动 `missingEvidence` 输出。

**代码实现**（`board.ts` L371-387）：
```typescript
function buildGaps(...): QueryBoard["gaps"] {
  if (seeds.length === 0) {
    return [{ question, reason: ... }];
  }
  // seed 非空时 gaps 为空
  return [];
}
```

**矛盾本质**：只有 seed 为空时才生成 gap。seed 非空时直接返回空数组，意味着即使用户的问题在 wiki 中只有部分覆盖，也不会识别缺口。这与 spec "明确说明缺少什么" 的要求直接矛盾。

---

#### 2.6 inspire 模式——未完全落地

**Spec 要求（v6.0 §8.8）**：inspire 输出应包含 `connections`、`hypotheses`、`questions`、`actions`、`missingEvidence`，每条带 `basedOn`（锚定 wiki 节点）、`confidence`、`evidenceBoundary`。

**代码实现**：`inspire.ts` 有一个启发式 fallback（当无 LLM 时基于 tag/counter/failed-node 生成简单启发），LLM 模式下依赖 LLM 自行按 prompt 输出 JSON。但 `inspire.ts` 的 `parseInspireItems` 解析逻辑需要处理多种 LLM 输出格式（JSON fence、wrapper、grouped），鲁棒性靠 fallback 而非结构化保证。

**矛盾本质**：Spec 设计了结构化的 inspire 输出合约，但代码依赖 LLM 自觉遵循 JSON 格式，没有 prompt 级别的强制约束（query 有 `responseFormat: "json_object"` 但 inspire 的 LLM prompt 不要求严格 schema 验证）。

---

#### 2.7 AuditStatus 类型定义与运行时语义矛盾

**Spec 要求（v6.0 §6.2）**：`auditStatus` 取值为 `pending | passed | warning | failed`。

**代码实现**：
- `types.ts` 中 `AuditStatus` 定义为 `"pending" | "passed" | "warning" | "failed"`（与 spec 一致）
- `audit.ts` 结构审计写回时只使用 `passed` 和 `failed`（没有 `warning`）
- `semantic-audit.ts` 语义审计写回时使用 `passed`、`warning`、`failed`
- `audit-gate.ts` 检查时额外使用了 `"failure"` 字符串（不在类型定义中）

**矛盾本质**：结构审计不产生 `warning` 状态，`audit-gate.ts` 使用了 `"failure"` 这个未定义在 `AuditStatus` 类型中的值。类型系统和运行时的语义不统一。

---

#### 2.8 v6.0 §15.1 质量指标 vs 实际产物

**Spec 要求**：
```
structureAuditCoverage >= 1.0
semanticAuditPassed >= 0.85
unsupportedClaims == 0
invalidChunkRefs == 0
missingEvidenceSections == 0
```

**实际情况**：
- `one-over-e-unification` 和 `time-constant-one-over-e` 的 chunkRefs 在 frontmatter 和 Evidence body 之间不一致（见 3.3）
- 所有 5 个节点的 `Evidence` section 中引用的 chunk 编号（如 [1, 2, 4, 7, 8, 9]）与 chase 文件实际只有 4 个 chunk marker 的事实不匹配——说明 Evidence body 中的 chunkRefs 可能是 LLM 编造的

---

### 三、代码实现内部的矛盾

#### 3.1 index.json 过期——auditStatus 与节点文件不一致

`wiki/index.json` 中所有 5 个节点的 `auditStatus` 都是 `"pending"`，但各个 wiki 节点文件中实际是 `passed`（2 个）和 `warning`（3 个）。

这说明 semantic audit 写回节点文件后，没有调用 `rebuildIndex()` 来同步 `index.json`。`audit-gate.json` 显示 `semanticScore: 0.98`、`semanticOk: true`，证明 audit 确实执行过。

**影响**：依赖 `index.json` 做搜索或 board 装配的模块会认为所有节点都还没审计过。

---

#### 3.2 kind/path 不匹配——insight 节点放在 concepts 目录

`one-over-e-unification` 节点的 frontmatter 声明 `kind: insight`，但文件实际存储在 `wiki/concepts/` 目录下。

`wiki-parser.ts` 的 `inferKindFromPath` 会根据目录推断 `kind: concept`，而 `parseWikiContent` 最终以 frontmatter 的 `kind: insight` 为准（这是正确的），但这导致了目录结构和节点类型之间的不一致，可能影响按目录过滤的逻辑。

---

#### 3.3 chunkRefs 数据三方不一致

以 `one-over-e-unification` 为例：

| 来源 | chunkRefs |
|------|-----------|
| frontmatter | `[1, 2, 3, 4]` |
| Evidence body | `[1, 2, 4, 7, 8, 9]` |
| index.json | `[1, 2, 4, 7, 8, 9]` |

`time-constant-one-over-e`：frontmatter `[3, 4]`，Evidence body `[7, 8, 9]`，index.json `[7, 8, 9]`。

更关键的是：chase 文件实际只有 4 个 chunk marker（chunk 1-4），不存在 chunk 7、8、9。这意味着 Evidence body 和 index.json 中引用的 chunk 编号是 LLM 编造的，违反了 agent contract 的核心条款："不编造证据"。

---

#### 3.4 legacy `source` 字段残留

所有 wiki 节点的 frontmatter 中同时存在 `source`（单数，v4/v5 遗留）和 `sourceIds`（v5+ 数组）。`render.ts` 没有输出 `source` 字段（它来自 compile 阶段的 LLM 输出），但 wiki-parser 也不解析它。这是一个无害但冗余的遗留字段。

---

#### 3.5 依赖项矛盾

- `sql.js` 在 `package.json` 的 `dependencies` 中列出，但源码中没有任何地方 import 它。`tsup.config.ts` 将 `better-sqlite3` 标记为 external，但 `better-sqlite3` 也不在依赖中。这是 v2 到 v3 删除 SQLite graph 后的遗留。
- `pdf-parse` 有类型声明文件（`pdf-parse.d.ts`），是 `dependencies` 中的依赖，但 `pdf-loader.ts` 实际使用的是 MinerU Agent API，不调用 `pdf-parse`。

---

#### 3.6 测试中的类型安全隐患

多个测试文件构造 config 对象时使用 `as AppConfig` 强制转换，但实际使用的字段名是 `rootDir` 而非 `AppConfig` 要求的 `projectRoot`。这个类型不匹配被 `as` 断言掩盖了。如果某天代码不再用 `as AppConfig` 而是依赖类型推导，这些测试会全部报错。

---

#### 3.7 chunkrefs-clamping 测试重新实现了被测函数

`chunkrefs-clamping.test.ts` 因为 `clampChunkRefs` 未从 `listening.ts` 导出，所以测试中重新实现了 `clampChunkRefsImpl`。如果生产代码的逻辑发生变化但测试中的副本没有同步更新，测试仍会通过而实际行为已经不同。

---

#### 3.8 E2E baseline JSON 无效

`e2e-baselines/` 下的三个 JSON 文件中使用了裸字符串 `N/A`（未加引号），导致它们是无效的 JSON。`e2e-pipeline.sh` 脚本中的 `json_field()` 函数在解析失败时 `echo "N/A"`，写入 heredoc 时没有加引号。

---

#### 3.9 Audit 系统 prompt 存在两份

`engine.ts` 定义了 `AUDIT_SYSTEM_PROMPT` 并通过 `cli-llm-init.ts` 的 `tryMakeLlmJudge` 使用（作为 system prompt 传给 `DeepSeekClient.chat`）。但 `semantic-audit-prompt.ts` 的 `buildSemanticAuditPrompt` 也在 user message 中嵌入了审计规则和输出格式要求。

这意味着 LLM 同时在 system prompt 和 user prompt 中收到了两套审计指令，它们虽然目前内容一致，但维护时容易不同步。

---

#### 3.10 search.ts 跳过 audit-failed 节点，但 board.ts 默认也跳过

`search.ts` 默认排除 `auditStatus === "failed"` 的节点。`board.ts` 的 `collectAllNodes` 也默认排除。这是正确的双重过滤，但 `search.ts` 和 `board.ts` 各自独立实现了这个逻辑，没有共享一个常量或函数，存在未来不一致的风险。

---

### 四、严重程度分级

| 级别 | 问题 | 影响 |
|------|------|------|
| **严重** | modelSynthesis 不拆分（2.1） | v6 核心产品特性失效，agent 无法区分 wiki 内容和 LLM 推理 |
| **严重** | chunkRefs 编造（3.3） | 违反 agent contract 核心条款"不编造证据"，audit 不应 pass |
| **严重** | index.json 过期（3.1） | 搜索和 board 装配可能基于过时的审计状态 |
| **高** | compare 模式空壳（2.4） | spec 定义的核心 query mode 之一无法正常工作 |
| **高** | gaps 构建为空（2.5） | 知识缺口无法被识别和报告 |
| **中** | boardRoles 从未生成（2.2） | board 装配失去按角色筛选的能力 |
| **中** | claimType/inferenceLevel 死代码（2.3） | spec 设计的重要分类维度无实际作用 |
| **中** | AuditStatus 类型语义不统一（2.7） | 代码中 `"failure"` 不在类型定义中，可能导致运行时类型错误 |
| **中** | kind/path 不匹配（3.2） | 目录结构和节点类型脱节 |
| **低** | 依赖项残留（3.5） | sql.js/pdf-parse 增加包体积但不影响功能 |
| **低** | E2E baseline JSON 无效（3.8） | 自动化 pipeline 无法解析 baseline 数据 |
| **低** | 测试类型安全（3.6）和函数重实现（3.7） | 长期维护风险 |

---

### 五、建议优先修复顺序

1. **修复 chunkRefs 编造问题**：在 compile 阶段强制校验 chunkRefs 不超出 chase 文件的实际 chunk 数量，audit 阶段增加 body chunkRefs 与 frontmatter chunkRefs 的一致性检查。
2. **实现 modelSynthesis 真正分层**：要求 LLM 输出结构化的 synthesis 条目（而非整段回答），或在 `makeDeepSeekCaller` 中做后处理拆分。
3. **修复 index.json 同步**：在 `writeAuditResults` 和 `writeSemanticAuditResults` 写回后自动调用 `rebuildIndex()`。
4. **完善 compare 模式和 gaps 构建**：实现按 sourceId 分组、tension 识别和缺口分析。
5. **激活 boardRoles**：在 ingest compile 阶段让 LLM 输出 boardRoles，或在 render 阶段基于 kind/tags 确定性推断。
6. **清理死代码和遗留依赖**。
