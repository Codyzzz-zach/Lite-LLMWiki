# Ingest-Audit Closed Loop + Board-Driven Inspire

## TL;DR
> **Summary**: 实现"无感入库 → 自动质量保证 → 结构化启发"闭环，让 agent 可以 `ingest --auto` 后自动获得带 audit 标记的 wiki，并在 inspire 中利用全量 wiki 结构（含 failed 张力节点）做有约束的发散。
> **Deliverables**: (1) ingest 自动触发 audit 并写回 auditStatus (2) search/query 默认排除 failed 节点 (3) board inspire 模式完整装配 (4) inspire heuristic fallback 升级
> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4

## Context
### Original Request
用户场景："我看到一篇好文章，无感放进知识库，系统自动搞定质量"。当前 ingest --auto 和 audit 之间没有自动衔接，audit 只报问题不处理，inspire board 返回空集。

### Interview Summary
- Agent-first 是主力，Human TUI 是亮点不是重点
- "自动 + 事后审查"模式：auto ingest → 全面 audit → 自动标记/降级
- Inspire 是事后交互核心功能，需 board-driven 合并
- Failed 节点不是垃圾，是 inspire 的张力素材
- CLI > TUI

### Gap Analysis (self-review)
- API key 缺失时 semantic audit 应跳过而非报错（结构 audit 仍跑）
- audit 写回 frontmatter 是幂等的（重跑可能因 LLM 非确定性改变结果，可接受）
- search/query 排除 failed 是破坏性变更，需 `--include-failed` flag 向后兼容
- inspire board 中 failed 节点需区分"语义失败"（有 claim，超 evidence → tension）vs"结构失败"（无 chase/evidence → 不参与 inspire）
- wiki/ 已 gitignore，audit 写回不产生 git 噪音
- 单进程 CLI，无并发写入竞态

## Work Objectives
### Core Objective
让 `ingest --auto` 成为一个完整的闭环操作：入库 → 审查 → 标记，之后 inspire 能利用全量 wiki 结构做有约束的发散。

### Deliverables
1. `ingest --auto` 完成后自动触发 audit（结构 + 语义），将 auditStatus/auditScore 写回 wiki 节点 frontmatter
2. search/query 默认只返回 `auditStatus: passed | warning | pending` 的节点，新增 `--include-failed` flag
3. board.ts inspire 模式实现完整装配逻辑（seed + evidence + related + counters + questions + tension nodes）
4. inspire heuristic fallback 升级（failed → hypothesis, tag-shared → connection, counter → question）

### Definition of Done
- `ingest --auto --policy conservative --json` 完成后，wiki 节点 frontmatter 包含正确的 auditStatus 和 auditScore
- 无 DEEPSEEK_API_KEY 时，ingest 仍成功，auditStatus 为结构审查结果（无语义审查）
- `search "term" --json` 不返回 auditStatus=failed 的节点
- `search "term" --include-failed --json` 返回全部节点
- `inspire --seed "x" --json` 的 board 包含 relatedNodes、counterNodes、questionNodes、tensionNodes
- inspire heuristic fallback 产出基于 failed 节点的 hypothesis
- `npm run typecheck && npm run test && npm run build` 全部通过

### Must Have
- audit 写回 frontmatter（这是闭环的基础）
- search/query 排除 failed 默认行为
- board inspire 完整装配

### Must NOT Have
- 不删除 failed 节点（只标记，不删除）
- 不修改 TUI 代码（CLI > TUI，TUI 不在本次范围）
- 不新增 CLI 命令（行为变更在现有命令内部）
- 不引入 embedding/vector search
- 不实现 graph 层

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after + existing test suite
- QA policy: Every task has agent-executed scenarios
- Evidence: .sisyphus/evidence/task-{N}-{slug}.{ext}

## Execution Strategy
### Parallel Execution Waves

Wave 1 (foundation — no dependencies between them):
- Task 1: audit 写回 frontmatter
- Task 2: search/query 排除 failed 节点

Wave 2 (depends on Wave 1):
- Task 3: ingest 自动触发 audit
- Task 4: board inspire 完整装配 + heuristic fallback 升级

### Dependency Matrix
| Task | Blocks | Blocked By |
|------|--------|------------|
| 1 | 3 | - |
| 2 | - | - |
| 3 | - | 1 |
| 4 | - | 1 |

### Agent Dispatch Summary
Wave 1: 2 tasks (deep + deep)
Wave 2: 2 tasks (deep + deep)

## TODOs

- [ ] 1. Audit 写回 frontmatter

  **What to do**:
  1. 在 `lite-llmwiki/src/knowledge/audit.ts` 中新增 `writeAuditResults(config, results)` 函数
  2. 遍历 audit 结果，对每个 wiki 节点：
     - 读取 .md 文件 → 解析 frontmatter → 更新 auditStatus/auditScore → 写回文件
  3. 在 `lite-llmwiki/src/knowledge/semantic-audit.ts` 中新增 `writeSemanticAuditResults(config, results)` 函数，同理写回
  4. 在 `lite-llmwiki/src/knowledge/wiki-parser.ts` 中确保 `parseWikiContent` 正确解析 auditStatus/auditScore，且 `serializeWikiContent`（新增）能正确写回
  5. 写回逻辑：只修改 frontmatter 中的 auditStatus/auditScore/auditScore 字段，不修改 body 内容
  6. 新增测试：mock wiki 文件 → 跑 audit → 写回 → 重新解析 → 验证 frontmatter 字段正确

  **Must NOT do**: 不修改 wiki body 内容，不删除节点文件，不改变 audit 的报告逻辑

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 需要理解 wiki-parser/frontmatter 序列化细节
  - Skills: [] - 不需要外部技能
  - Omitted: [`brainstorming`] - 设计已确定

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [3, 4] | Blocked By: []

  **References**:
  - Pattern: `lite-llmwiki/src/knowledge/audit.ts` - 当前 audit 逻辑，只报不修
  - Pattern: `lite-llmwiki/src/knowledge/wiki-parser.ts` - parseWikiContent 解析逻辑
  - Pattern: `lite-llmwiki/src/knowledge/semantic-audit.ts` - semantic audit 结果结构
  - Type: `lite-llmwiki/src/types.ts:AuditSummary` - audit 结果类型
  - Type: `lite-llmwiki/src/types.ts:SemanticAuditResult` - semantic audit 结果类型
  - Test: `lite-llmwiki/tests/v6-frontmatter.test.ts` - frontmatter 解析测试模式

  **Acceptance Criteria** (agent-executable only):
  - [ ] `writeAuditResults` 函数存在且导出
  - [ ] `writeSemanticAuditResults` 函数存在且导出
  - [ ] 测试通过：mock wiki → audit → writeAuditResults → 重新解析 → auditStatus === "passed"/"failed"
  - [ ] 测试通过：semantic audit 写回后 auditScore 为数字
  - [ ] `npm run typecheck` 通过

  **QA Scenarios** (MANDATORY):
  ```
  Scenario: Write audit results to wiki frontmatter
    Tool: Bash
    Steps: npm run test -- --reporter=verbose tests/v6-frontmatter.test.ts
    Expected: all tests pass, auditStatus written correctly
    Evidence: .sisyphus/evidence/task-1-audit-writeback.txt

  Scenario: Audit writeback preserves body content
    Tool: Bash
    Steps: npm run test -- tests/audit-writeback.test.ts (new test)
    Expected: wiki body unchanged after writeback, only frontmatter modified
    Evidence: .sisyphus/evidence/task-1-audit-writeback-preserve.txt
  ```

  **Commit**: YES | Message: `feat(audit): write auditStatus/auditScore back to wiki frontmatter` | Files: [lite-llmwiki/src/knowledge/audit.ts, lite-llmwiki/src/knowledge/semantic-audit.ts, lite-llmwiki/src/knowledge/wiki-parser.ts, lite-llmwiki/tests/audit-writeback.test.ts]

- [ ] 2. Search/Query 默认排除 failed 节点

  **What to do**:
  1. 在 `lite-llmwiki/src/query/search.ts` 的 `searchWiki` 中，默认过滤掉 `auditStatus === "failed"` 的节点
  2. 新增 `includeFailed?: boolean` 选项到 SearchOptions
  3. 在 `lite-llmwiki/src/cli/commands/search.ts` 中注册 `--include-failed` flag
  4. 在 `lite-llmwiki/src/query/engine.ts` 的 `queryKnowledge` 中，board 装配时默认排除 failed 节点（除非 `includeFailed`）
  5. 在 `lite-llmwiki/src/cli/commands/query.ts` 中注册 `--include-failed` flag
  6. 新增测试：验证 search 默认不返回 failed 节点，`--include-failed` 时返回

  **Must NOT do**: 不修改 board.ts 的核心装配逻辑（Task 4 处理），不删除 failed 节点文件

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 需要理解 search/query 的过滤链路
  - Skills: [] - 不需要外部技能
  - Omitted: [`brainstorming`] - 设计已确定

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [] | Blocked By: []

  **References**:
  - Pattern: `lite-llmwiki/src/query/search.ts` - searchWiki 函数，当前不过滤 auditStatus
  - Pattern: `lite-llmwiki/src/query/engine.ts` - queryKnowledge 函数
  - Pattern: `lite-llmwiki/src/cli/commands/search.ts` - search CLI 注册
  - Pattern: `lite-llmwiki/src/cli/commands/query.ts` - query CLI 注册
  - Type: `lite-llmwiki/src/types.ts:SearchMatchV6` - search 结果类型，含 auditStatus 字段

  **Acceptance Criteria** (agent-executable only):
  - [ ] search 默认不返回 auditStatus=failed 的节点
  - [ ] search --include-failed 返回全部节点
  - [ ] query 默认 board 不含 failed 节点
  - [ ] query --include-failed board 含 failed 节点
  - [ ] 现有测试仍通过（向后兼容）
  - [ ] `npm run typecheck` 通过

  **QA Scenarios** (MANDATORY):
  ```
  Scenario: Search excludes failed nodes by default
    Tool: Bash
    Steps: npm run test -- tests/search-failed-filter.test.ts (new test)
    Expected: search results contain no auditStatus=failed nodes
    Evidence: .sisyphus/evidence/task-2-search-exclude-failed.txt

  Scenario: Search includes failed nodes with flag
    Tool: Bash
    Steps: npm run test -- tests/search-failed-filter.test.ts (new test)
    Expected: search --include-failed results contain failed nodes
    Evidence: .sisyphus/evidence/task-2-search-include-failed.txt
  ```

  **Commit**: YES | Message: `feat(search): exclude auditStatus=failed nodes by default, add --include-failed flag` | Files: [lite-llmwiki/src/query/search.ts, lite-llmwiki/src/query/engine.ts, lite-llmwiki/src/cli/commands/search.ts, lite-llmwiki/src/cli/commands/query.ts, lite-llmwiki/tests/search-failed-filter.test.ts]

- [ ] 3. Ingest 自动触发 Audit

  **What to do**:
  1. 在 `lite-llmwiki/src/cli/commands/ingest.ts` 的 `runIngest` 末尾，ingest 成功后自动触发：
     - `auditWiki(config)` → 结构审查
     - 如果有 DEEPSEEK_API_KEY：`runSemanticAudit(config, { llmJudge })` → 语义审查
     - 如果无 API key：跳过语义审查，不报错
  2. 调用 Task 1 的 `writeAuditResults` 和 `writeSemanticAuditResults` 写回 frontmatter
  3. 在 ingest 的 JSON 输出中增加 `audit` 字段，包含结构 + 语义审查结果摘要
  4. 新增 `--no-audit` flag 允许跳过自动 audit（向后兼容，默认开启）
  5. 新增测试：验证 ingest --auto 后 wiki 节点包含 auditStatus

  **Must NOT do**: 不改变 ingest 的核心逻辑（加载/清洗/编译），不改变 policy 过滤逻辑

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 需要理解 ingest CLI 的完整流程和 JSON 输出格式
  - Skills: [] - 不需要外部技能
  - Omitted: [`brainstorming`] - 设计已确定

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: [] | Blocked By: [1]

  **References**:
  - Pattern: `lite-llmwiki/src/cli/commands/ingest.ts` - runIngest 函数，当前 ingest 完成后直接返回
  - Pattern: `lite-llmwiki/src/cli/commands/audit.ts` - runAuditCli 函数，audit CLI 逻辑
  - Pattern: `lite-llmwiki/src/knowledge/audit.ts` - auditWiki 函数
  - Pattern: `lite-llmwiki/src/knowledge/semantic-audit.ts` - runSemanticAudit 函数
  - Type: `lite-llmwiki/src/types.ts:AgentFailure` - agent failure JSON shape

  **Acceptance Criteria** (agent-executable only):
  - [ ] ingest --auto 完成后 wiki 节点 frontmatter 包含 auditStatus
  - [ ] 无 DEEPSEEK_API_KEY 时 ingest 仍成功，auditStatus 为结构审查结果
  - [ ] 有 DEEPSEEK_API_KEY 时 auditStatus 为语义审查结果
  - [ ] ingest JSON 输出包含 audit 摘要字段
  - [ ] `--no-audit` flag 跳过自动 audit
  - [ ] `npm run typecheck && npm run test` 通过

  **QA Scenarios** (MANDATORY):
  ```
  Scenario: Auto-audit after ingest with API key
    Tool: Bash
    Steps: npm run test -- tests/ingest-auto-audit.test.ts (new test)
    Expected: ingest output contains audit summary, wiki nodes have auditStatus
    Evidence: .sisyphus/evidence/task-3-ingest-auto-audit.txt

  Scenario: Auto-audit without API key (structure only)
    Tool: Bash
    Steps: DEEPSEEK_API_KEY="" npm run test -- tests/ingest-auto-audit.test.ts
    Expected: ingest succeeds, auditStatus from structure audit only, no error
    Evidence: .sisyphus/evidence/task-3-ingest-no-key.txt

  Scenario: Skip auto-audit with --no-audit
    Tool: Bash
    Steps: npm run test -- tests/ingest-auto-audit.test.ts
    Expected: ingest succeeds, wiki nodes have auditStatus: "pending" (default, not audited)
    Evidence: .sisyphus/evidence/task-3-ingest-no-audit.txt
  ```

  **Commit**: YES | Message: `feat(ingest): auto-trigger audit after --auto ingest, write auditStatus to frontmatter` | Files: [lite-llmwiki/src/cli/commands/ingest.ts, lite-llmwiki/tests/ingest-auto-audit.test.ts]

- [ ] 4. Board Inspire 完整装配 + Heuristic Fallback 升级

  **What to do**:
  1. 在 `lite-llmwiki/src/query/board.ts` 的 `assembleBoard` 中，实现 inspire 模式完整装配：
     ```typescript
     case "inspire": {
       // seed + evidence neighbors (by sourceChase shared)
       const evidenceNodes = pickEvidence(seeds, allBoardNodes, seedIds, 5);
       // cross-kind related: insight/question/counter/anchor (by tag shared)
       const inspireKinds: WikiKind[] = ["insight", "question", "counter", "anchor"];
       const relatedNodes = allBoardNodes
         .filter(n => inspireKinds.includes(n.kind) && !seedIds.has(n.nodeId))
         .filter(n => n.tags.some(t => seedTags.has(t)) || n.sourceIds.some(s => seedSourceIds.has(s)))
         .slice(0, 6);
       const limitNodes = seeds.filter(n => n.limits.length > 0).slice(0, 3);
       const counterNodes = allBoardNodes.filter(n => n.kind === "counter").slice(0, 5);
       const questionNodes = allBoardNodes.filter(n => n.kind === "question").slice(0, 4);
       return { seedNodes: seeds, evidenceNodes, relatedNodes, limitNodes, counterNodes, questionNodes };
     }
     ```
  2. 在 `AssembledBoard` 中新增 `tensionNodes: BoardNode[]` 字段
  3. 在 board 装配中，收集 `auditStatus === "failed"` 且有 claim 的语义失败节点作为 tensionNodes
  4. 在 `lite-llmwiki/src/query/inspire.ts` 的 heuristic fallback 中升级：
     - tag 共享节点对 → connection（"A 和 B 共享标签 X，可能存在关联"）
     - counter 节点对 seed → question（"counter 是否挑战 seed？"）
     - tension node（语义失败）→ hypothesis（"此 claim 缺少完整证据支撑，可能的方向：..."）
     - 跨 source 同 tag 节点 → connection with evidenceBoundary
  5. 在 `QueryBoard` 类型中新增 `tensionNodes` 字段
  6. 新增测试：验证 board inspire 模式返回非空集合，tensionNodes 包含语义失败节点

  **Must NOT do**: 不修改 inspire.ts 的接口（InspireItem/InspireResult 类型不变），不修改 inspire CLI 注册逻辑

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 需要理解 board 装配逻辑和 inspire heuristic fallback 的完整链路
  - Skills: [] - 不需要外部技能
  - Omitted: [`brainstorming`] - 设计已确定

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: [] | Blocked By: [1]

  **References**:
  - Pattern: `lite-llmwiki/src/query/board.ts:assembleBoard` - 当前 inspire 返回空集，需实现完整装配
  - Pattern: `lite-llmwiki/src/query/board.ts:pickEvidence` - evidence 挑选逻辑，可复用
  - Pattern: `lite-llmwiki/src/query/board.ts:pickRelated` - related 挑选逻辑，可复用
  - Pattern: `lite-llmwiki/src/cli/commands/inspire.ts:runInspireCli` - inspire CLI，heuristic fallback 在第 158-186 行
  - Type: `lite-llmwiki/src/types.ts:QueryBoard` - board 类型定义
  - Type: `lite-llmwiki/src/types.ts:BoardNode` - board 节点类型
  - Test: `lite-llmwiki/tests/board.test.ts` - board 测试模式
  - Test: `lite-llmwiki/tests/inspire.test.ts` - inspire 测试模式

  **Acceptance Criteria** (agent-executable only):
  - [ ] board inspire 模式返回非空 evidenceNodes/relatedNodes/counterNodes/questionNodes
  - [ ] board 包含 tensionNodes（语义失败节点）
  - [ ] inspire heuristic fallback 产出基于 failed 节点的 hypothesis
  - [ ] inspire heuristic fallback 产出基于 tag 共享的 connection
  - [ ] inspire heuristic fallback 产出基于 counter 的 question
  - [ ] 现有 board/inspire 测试仍通过
  - [ ] `npm run typecheck && npm run test && npm run build` 通过

  **QA Scenarios** (MANDATORY):
  ```
  Scenario: Board inspire returns rich nodes
    Tool: Bash
    Steps: npm run test -- tests/board.test.ts
    Expected: inspire mode board has evidenceNodes.length > 0, relatedNodes.length > 0
    Evidence: .sisyphus/evidence/task-4-board-inspire.txt

  Scenario: Inspire heuristic fallback produces hypotheses from failed nodes
    Tool: Bash
    Steps: npm run test -- tests/inspire.test.ts
    Expected: inspire result contains hypotheses with basedOn referencing failed nodeIds
    Evidence: .sisyphus/evidence/task-4-inspire-hypothesis.txt

  Scenario: Inspire with LLM caller
    Tool: Bash
    Steps: npm run test -- tests/inspire.test.ts
    Expected: inspire result contains connections/hypotheses/questions from LLM
    Evidence: .sisyphus/evidence/task-4-inspire-llm.txt
  ```

  **Commit**: YES | Message: `feat(inspire): board-driven inspire with full assembly, tension nodes, upgraded heuristic fallback` | Files: [lite-llmwiki/src/query/board.ts, lite-llmwiki/src/query/inspire.ts, lite-llmwiki/src/types.ts, lite-llmwiki/tests/board.test.ts, lite-llmwiki/tests/inspire.test.ts]

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE.
- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy
- Task 1: `feat(audit): write auditStatus/auditScore back to wiki frontmatter`
- Task 2: `feat(search): exclude auditStatus=failed nodes by default, add --include-failed flag`
- Task 3: `feat(ingest): auto-trigger audit after --auto ingest, write auditStatus to frontmatter`
- Task 4: `feat(inspire): board-driven inspire with full assembly, tension nodes, upgraded heuristic fallback`
- Final: `chore: update test baseline after ingest-audit-inspire closed loop`

## Success Criteria
- `ingest --auto --policy conservative --json` 完成后 wiki 节点 frontmatter 包含正确的 auditStatus/auditScore
- 无 API key 时 ingest 仍成功（结构 audit only）
- search/query 默认不返回 failed 节点，`--include-failed` 时返回
- inspire board 包含完整装配（非空集合）+ tensionNodes
- inspire heuristic fallback 产出 hypothesis（基于 failed 节点）
- `npm run typecheck && npm run test && npm run build` 全部通过
