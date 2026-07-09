## LiteWikiagent 矛盾重新评估报告

日期: 2026-06-15

本报告基于对 spec 自身逻辑一致性、spec-code 精确偏差、以及 AI 辅助开发自然熵增三个维度的深度分析，对之前报告中的所有矛盾进行重新分类和评估。

---

### 分类说明

每个问题被归入以下四类之一：

- **设计层真矛盾**：Spec 自身的逻辑矛盾或哲学裂缝，需要修改设计而非代码
- **实现层偏差**：Spec 设计合理但代码未跟上，需要修代码
- **可接受的简化**：MVP 阶段的务实取舍，暂不需要改
- **误报 / 已修复**：上一份报告的误判或已不存在的问题

---

## 第一类：设计层真矛盾（需要改 spec）

### 1. 「不限制 LLM 推理」vs「强制输出分层」——spec 最大的哲学裂缝

**矛盾所在：**

Spec §2.2 说「LLM 的推理空间需要保留，v6.0 只要求它不要脱离 wiki 所提供的用户知识结构」。§12.3 说「query prompt 不应该过度规定思考路线」。

但 §9 要求 LLM 把每个回答分解为 `fromWiki` / `modelSynthesis` / `missingEvidence` 三个数组，每条带 `basedOn` 和 `confidence`。

**为什么这是真矛盾：**

要求 LLM 自我分类其推理来源，本质上是一个元认知任务——"这句话是从 wiki 来的还是我自己推的？"。但 LLM 并不具备可靠的这种自我审查能力。具体来说：

- LLM 用自己的话复述一条 wiki claim，这算 `fromWiki` 还是 `modelSynthesis`？
- LLM 把两个 wiki 节点综合出一条两者都没单独陈述的推论——这正是 spec 鼓励的「在知识结构内自由推理」——但按 §9 的分类它应该标为 `modelSynthesis`（暗示可信度低于 `fromWiki`），这实际上在惩罚 spec 鼓励的行为。
- §9.1 同时有 `answer`（自由文本）和三个分解数组，但 spec 从未定义 `answer` 和分解数组之间的关系。LLM 要么重复写两遍（answer + 分解），要么 answer 和分解脱节。

**建议：**

修改 spec §9 的输出设计。有两条可行路线：

**路线 A（务实）**：放弃要求 LLM 自我分解。`answer` 是唯一的输出，但 system prompt 要求 LLM 在答案中用 `[nodeId]` 引用标注来源。后处理阶段用正则提取引用，自动构建 `fromWiki`（有引用的部分）和 `modelSynthesis`（无引用的部分）。这把分层从 LLM 的元认知任务变成了确定性的后处理任务。

**路线 B（理想）**：保留分层，但不再让 LLM 同时写 `answer` 和分解数组。改为：LLM 输出 JSON，每条 statement 带 `text`、`sources: [nodeId]`（空 = 模型推理）、`type: "wiki" | "synthesis" | "gap"`。由代码侧拼装 `answer` 文本。这消除了 `answer` 和分解的歧义，但增加了 LLM 输出约束。

当前代码的整段回答作为一条 `modelSynthesis` 的做法，其实是这个设计层矛盾的**自然症状**——代码选择了最简单的实现，恰恰因为 spec 的期望在工程上不可靠。

---

### 2. boardRoles 与 kind 的概念重叠

**矛盾所在：**

`kind`（v5 遗留）有 9 个值：`concept | claim | method | case | equation | question | insight | anchor | counter`。

`boardRoles`（v6 新增）有 9 个值：`evidence | concept | method | case | limit | counter | question | anchor | bridge`。

其中 6 个值（concept, method, case, counter, question, anchor）在两者中完全重复。

**为什么这是真矛盾：**

Spec §6.2 试图区分：「boardRoles 不是知识类型本身，而是上下文装配时的用途」。但这个区分在逻辑上站不住：

- 一个 `kind: counter` 的节点在 board 上除了扮演 `counter` 还能扮演什么？Spec 没有给出任何场景说明 counter 节点会扮演 `evidence` 或 `concept`。
- 一个 `kind: concept` 的节点什么时候会需要 `boardRoles: [limit]`？Spec 也没有解释。
- 真正独立的角色只有 `bridge`（没有对应 kind）和 `limit`（没有对应 kind）。其余 6 个是 kind 的同义重复。

更关键的是：spec 从未定义 boardRoles 的生成规则。是由 compile LLM 赋值？由 kind 推导？多个 role 怎么决定？没有生产者，也没有消费者（board builder 从未读取 boardRoles）。

**建议：**

两个选项：

**选项 A（精简）**：删除 `boardRoles`，在 board builder 中用 `kind` + 少量规则覆盖 `bridge` 和 `limit` 的场景。例如：`kind: concept` 且 `limits` 非空的节点同时可作为 limit 节点；被两个不同 source 的节点共同引用的节点自动成为 bridge。这用 ~20 行代码就能实现，不需要额外字段。

**选项 B（保留但重新定义）**：保留 `boardRoles`，但把它从 schema 字段降级为 board builder 运行时计算的派生属性（不写入 frontmatter），由 kind + tags + evidence 结构推导。这样 boardRoles 变成了 board 装配的内部概念而非节点属性。

---

### 3. purpose.md / agent-contract.md 与 v6 spec 的隐性冲突

**矛盾所在：**

`purpose.md`（v0.1，未标记废弃）定义了编译过滤规则：「符合以下任一条件的事实优先编译」「以下内容降级处理」。这是价值门控——决定什么值得编译。

但 v6 spec §2.1 明确宣布「不做入库价值判断」「产品质量闸门不在 raw 入口」。

`agent-contract.md`（v0.2，未标记废弃）描述了 Pro Listening / Flash Compiler 双 agent 架构、`devilsAdvocate` 输出、`HypothesisOption` 结构。这些概念在 v6 中都不存在。

**为什么这是真矛盾：**

两份遗留 spec 文档仍然活跃在 spec 目录中，被 README 和 helper 引用。如果新开发者或外部 agent 读到 purpose.md，会按其中的过滤规则理解系统行为，与 v6 实际行为产生认知偏差。

**建议：**

在 purpose.md 顶部添加 `> ⚠️ Legacy: v0.1 意图文档，已被 v6.0 spec §2.1 取代。v6 不做 raw 入库门控。`。同理在 agent-contract.md 顶部标注已被 v6 spec §11 取代。或者直接移入 `spec/archive/`。

---

### 4. Agent Contract 是硬协议还是行为规范？

**矛盾所在：**

v6 spec §2.4 和 §11 称 agent contract 为「硬协议」。§11.2 列出禁止行为：不得把 modelSynthesis 当 fromWiki、不得隐藏 missingEvidence、不得自动覆盖用户手工修改的 wiki。

**为什么这是真矛盾：**

CLI 能强制执行的只有一件事：audit 失败时拒绝 query。其余所有禁止行为都是对外部 agent（Reasonix、Claude Code 等）的行为期望，CLI 无法检测也无法阻止外部 agent 违反它们。外部 agent 有文件系统访问权限，可以绕过 CLI 直接操作 wiki 文件。

称之为「硬协议」给读者一种安全感，但实际保障远不如暗示的那么强。

**建议：**

在 spec §11 中明确区分两层：

- **硬约束**（CLI 层面强制执行）：audit gate 阻断 query/inspire；ingest 失败返回结构化错误 JSON
- **软约束**（对外部 agent 的行为建议）：其余所有 §11.2 条款

把标题从「硬协议」改为「协议」或「agent 行为规范」，避免过度承诺。

---

### 5. Inspire 与「wiki 是棋盘」的哲学裂缝

**矛盾所在：**

ask/trace/expand/compare/challenge 都是在已有棋盘上推理——LLM 在已有知识结构内工作。

但 inspire 要求「意外连接」「新问题」「下一步该研究什么」——这不是在棋盘上下棋，这是要求 LLM 从已有棋盘推导出新棋盘。这是本质不同的操作。

Spec §17.3 承认了这个问题：「inspire 最容易漂移」，缓解措施是「每个启发项必须带 wiki anchors」。但这产生了新矛盾：如果每条启发都必须锚定到已有节点，那启发范围就被 wiki 当前覆盖率所限制——wiki 越小，inspire 越浅。而 inspire 最有价值的场景恰恰是 wiki 还小、需要发现扩展方向的时候。

**建议：**

重新定位 inspire 的预期：

- 对小型 wiki（<20 nodes），inspire 的主要价值是「基于已有节点提出应该 ingest 什么新材料」（即 `missingEvidence` + `action` 类型的启发），而非跨域发现
- 对大型 wiki（>50 nodes），inspire 可以真正做弱连接发现和跨 source 综合

在 spec §8.8 中加入这个分层预期，避免对小 wiki 用户承诺「意外连接」但实际只能给出浅层 tag 匹配。

---

### 6. Semantic Audit 的认识论循环

**矛盾所在：**

Semantic audit 用一个 LLM 判断另一个 LLM 的编译是否忠实。产出的 `auditScore: 0.95` 带有客观性的暗示。

**为什么值得重新审视：**

这不是说 audit 没有价值——它确实能捕获明显的语义漂移。但 spec 把它呈现为可靠的质量闸门（「wiki 是否忠实可靠：系统审查」），而实际上它是一个 LLM 的主观评估。一个 0.95 的 auditScore 并不意味着 95% 忠实，它意味着「judge LLM 在这次调用中认为基本忠实」。

**建议：**

在 spec §7 中加入一段诚实的局限性说明：semantic audit 是辅助信号而非客观度量。建议用户把 `warning` 和 `failed` 视为需要人工复核的触发器，而非最终判决。这不削弱 audit 的价值，反而增加了可信度。

---

## 第二类：实现层偏差（需要修代码）

### 7. compare 模式空壳

**现状：** board.ts 的 compare 分支与 ask 几乎无区别。`findSeedNodes` 中有空注释 `// compare 模式：按 sourceId 分组` 但无实际分组逻辑。

**评估：真问题，需修复。** compare 的全部价值在于分组对比，没有分组的 compare 就是 ask。

**修复方案（~40 行）：**

在 `assembleBoard` 的 `compare` 分支中：
1. 将 seeds 按 `sourceIds[0]` 分组
2. 对每组分别取 evidence/limits
3. 在 `serializeBoardToPrompt` 中按组输出（`── Group A (source: X) ──`）
4. 识别 cross-group tension：不同组中 claim 存在矛盾关键词的节点对

---

### 8. gaps 构建为空

**现状：** `buildGaps` 只在 seeds 为空时生成 gap，seeds 非空时直接返回空数组。

**评估：真问题，需修复。** 即使有部分匹配，board 也应该报告未覆盖的方面。

**修复方案（~20 行）：**

当 seeds 非空时，检查 board 的 kind 覆盖情况：
- 如果 mode 是 `challenge` 但没有 counter 节点 → gap: "no counter-argument in wiki"
- 如果 mode 是 `expand` 但没有 method/case 类型的相关节点 → gap: "no method or case supports this concept"
- 如果 seeds 只覆盖一个 source → gap: "only one source covers this topic"

这种启发式不需要 LLM，纯确定性计算。

---

### 9. index.json 审计后未同步

**现状：** audit 写回节点 frontmatter 后未调用 `rebuildIndex()`，导致 index.json 的 `auditStatus` 全部停留在 `"pending"`。

**评估：真问题，需修复。** 这是最明确的 bug——一行代码的遗漏。

**修复方案（1 行）：**

在 `cli/commands/audit.ts` 的 `runAuditCli` 末尾，`writeAuditResults` 和 `writeSemanticAuditResults` 之后加 `store.rebuildIndex()`。

---

### 10. kind/path 不匹配

**现状：** `one-over-e-unification` 的 `kind: insight` 但文件在 `wiki/concepts/`。`normalizeWikiFilePath` 接受了 LLM 提供的不匹配路径。

**评估：真问题，低频但影响清晰。** 需修复以防止未来重演。

**修复方案（3 行）：**

在 `listening.ts` 的 `normalizeWikiFilePath` 中，如果 LLM 提供的路径的目录不匹配 `directoryByKind[kind]`，使用 fallback 路径而非 LLM 提供的路径。

---

### 11. chunkRefs 越界——Evidence body 中出现不存在的 chunk 编号

**现状：** `one-over-e-unification` 的 Evidence body 引用 chunk 7、8、9，但 chase 文件只有 4 个 chunk。`time-constant-one-over-e` 同理。

**评估：需要重新理解问题。**

`clampChunkRefs` 函数存在于 `listening.ts` 并确实对 frontmatter 的 chunkRefs 做了越界过滤。但 Evidence body 中的 chunk 编号来自 compile LLM 的原始输出，走的是不同的代码路径——`normalizeEvidenceArray` 中的 evidence 级 chunkRefs 和 proposition 级 fallback chunkRefs 的合并逻辑。

问题的根源是：compile LLM 输出的 evidence 中的 `chunk_idx` 可能是 LLM 编造的（尤其是 insight 类型的综合节点，它需要引用多个来源的不同位置）。`clampChunkRefs` 只在顶层做了 clamp，但 evidence 内部嵌套的 chunkRefs 走的是另一条路径。

**修复方案（~15 行）：**

在 `parseProResult` 的 evidence 处理阶段，对每条 evidence 的 `chunkRefs` 也调用 `clampChunkRefs`（当前只对顶层 `chunkRefs` 做了）。同时对 `audit.ts` 增加一项检查：对比 frontmatter chunkRefs 和 Evidence body 中出现的 chunk 编号，如果不一致则报 warning。

---

## 第三类：可接受的简化（暂不需要改）

### 12. modelSynthesis 未拆分

**重新评估：** 这个问题在之前的报告中被标为「严重」，但经过深入分析 spec 自身矛盾后（见第 1 条），我认为当前代码的「偷懒」恰恰是对 spec 设计缺陷的自然响应。在 spec §9 的输出分层设计被重新定义之前（路线 A 或 B），强行实现当前的分层只会产出一个看起来符合 spec 但实际不可靠的输出。

**建议：** 等 spec §9 确定新方向后再实现。当前 `fromWiki` 已经正确填充（从 board seedNodes 投影），`answer` 包含完整 LLM 回答——对用户来说已经够用了。

---

### 13. claimType 和 inferenceLevel 从未生成

**重新评估：** 这两个字段在 spec §6.2 中被定义为「帮助 board setup 正确摆局」，但 board builder 的 6 个 mode 分支中没有任何一个读取或使用它们。semantic audit 的 5 个审查维度（support/addition/inference/limits/citation）本质上覆盖了同样的信息。

**评估：可接受的简化。** 这两个字段对当前功能没有实际消费者。如果未来 graph 构建需要它们（Phase 6），届时可以用简单的启发式从 kind + audit 结果推导：`concept` → `source_claim`，`insight` → `interpretation`，`counter` → `counter`。

---

### 14. boardRoles 从未生成

**重新评估：** 见第 2 条。在 spec 自身重新设计 boardRoles 的定位之前，代码侧没有生成它是合理的——因为生成了也没有消费者。

---

### 15. legacy `source` 字段

**评估：可接受的向后兼容。** `normalizeFrontmatter` 正确地将 `source` 合并入 `sourceIds`，所有下游代码都读 `sourceIds`。冗余无害。

---

### 16. Audit 系统 prompt 存在两份

**评估：可接受但需注意维护。** `AUDIT_SYSTEM_PROMPT`（system message）和 `buildSemanticAuditPrompt`（user message）确实包含重叠的审计规则。但它们扮演的角色不同：system prompt 定义角色身份，user prompt 提供具体的节点数据和审查维度。当前内容一致，不会导致功能问题。建议在 `semantic-audit-prompt.ts` 顶部加注释说明：审计规则应以 `AUDIT_SYSTEM_PROMPT` 为单一真相源，此处的 user prompt 只提供数据上下文。

---

### 17. 测试中的类型安全问题和 clampChunkRefs 重实现

**评估：长期维护风险，但不影响功能。** `as AppConfig` 的类型断言和 `clampChunkRefsImpl` 的重实现是 AI 辅助开发中常见的模式——快速让测试跑起来，但留下技术债。在下一个大版本重构时统一处理即可。

---

### 18. 依赖项残留（sql.js / pdf-parse）

**评估：可接受。** 移除它们是 5 分钟的工作，不影响功能。可以在下次清理依赖时一起做。

---

### 19. E2E baseline JSON 无效

**评估：可接受。** 这些是诊断快照而非运行依赖。`e2e-pipeline.sh` 的 `json_field` 函数需要修复 `N/A` 的引号问题，但优先级很低。

---

## 第四类：误报 / 已修复

### 20. AuditStatus 类型中的 "failure"

**重新评估：** 经代码精确搜索，`audit-gate.ts` 实际使用的是 `"failed"` 而非 `"failure"`。类型定义和运行时一致。上一份报告的这个判断有误。

---

## 总结：优先级排序

| 优先级 | 编号 | 问题 | 类型 | 行动 |
|--------|------|------|------|------|
| **P0** | 1 | 输出分层设计矛盾 | spec 层 | 选定路线 A 或 B 后重写 §9 |
| **P0** | 3 | 遗留 spec 文档冲突 | spec 层 | 标注废弃或移入 archive |
| **P1** | 7 | compare 模式空壳 | 代码层 | ~40 行修复 |
| **P1** | 9 | index.json 审计后未同步 | 代码层 | 1 行修复 |
| **P1** | 11 | Evidence body chunkRefs 越界 | 代码层 | ~15 行修复 |
| **P2** | 8 | gaps 构建为空 | 代码层 | ~20 行修复 |
| **P2** | 10 | kind/path 不匹配 | 代码层 | 3 行修复 |
| **P2** | 2 | boardRoles 概念重叠 | spec 层 | 精简或重新定义 |
| **P2** | 4 | Agent Contract 硬协议措辞 | spec 层 | 区分硬/软约束 |
| **P3** | 5 | inspire 哲学裂缝 | spec 层 | 分层预期 |
| **P3** | 6 | semantic audit 认识论局限 | spec 层 | 添加局限性说明 |
| — | 12-19 | 可接受的简化 | — | 暂不改 |

P0 的两个问题之所以最优先，是因为它们不是代码 bug，而是设计层的逻辑矛盾。如果 spec 自身不清楚输出该怎么分层、哪些文档是现行的，那代码层面的修复只会制造更多局部发散。先定 spec，再改代码。
