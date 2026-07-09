# Loop Engineering 施工计划

> 本文件是 Ralph-style 开发 loop 的任务清单。
> 每轮 agent 会话开头读此文件，挑一个任务执行。
> 完成的任务标记 [x]，失败/卡住的任务标记 [!]。

## 确认的决断汇总（2026-07-08）

| # | 决断 | 选择 |
|---|------|------|
| 1 | daemon 不存在时命题提取 | 先建完基础施工再跑产品 loop；施工期间 CLI 内联 |
| 2 | 向后兼容 | 清空现有 wiki，不保留 |
| 3 | inspire 触发 | 人类手动触发（架构设计为准） |
| 5 | propRefs vs chunkRefs | 全量改 chunkRefs → propRefs |
| 7 | qmd 集成 | 基础施工期间集成 |
| - | loop 层面 | 两者都要（开发 loop + 产品 loop）|
| - | 阶段边界 | 10 个判定条件全满足 = 阶段 1 结束 |

## 施工步骤

### 第 0 步：修复现有代码 ✅ 已完成
- [x] 0.1 修复 typecheck error（src/cli/ui/App.tsx:467 — chat UI 缺 llmCaller 参数）
- [x] 0.2 修复 26 个失败测试（根因：测试期望无 key 降级，但代码改为必填抛错）
- [x] 0.3 验证：npm run typecheck ✅ 退出 0 + npm test ✅ 234 pass / 4 skip
- 预算：最多 3 轮，同一错误连续 2 次升级给人
- 约束：不得删除现有测试，不得改变 llmCaller 必填的设计决策

### 第 1 步：数据模型改造 ✅ 已完成
- [x] 1.1 types.ts：新增 GraphEdge/GraphEdgeType/ChaseProp；WikiFrontmatter 增加 auditVerdict/reflowOrigin/edges；全局 chunkRefs→propRefs
- [x] 1.2 chase.ts：保留现有实现（readChaseChunks/selectChaseChunks 不变，Step 2 命题提取时改造）
- [x] 1.3 wiki-parser.ts：适配 propRefs 新字段
- [x] 1.4 重写现有测试 fixture 为新格式（propRefs 替代 chunkRefs）
- [x] 1.5 验证：npm run typecheck ✅ + npm test ✅（234 pass / 4 skip）

### 第 2 步：命题提取 ✅ 已完成
- [x] 2.1 新建 ingest/proposition.ts：命题提取 prompt + LLM 调用 + 响应解析 + chase MD 更新
- [x] 2.2 CLI 加 extract-props 命令（过渡方案，daemon 建好后保留作为手动触发选项）
- [x] 2.3 chase.ts：readChaseProps() 完整实现 + parseChaseProps()
- [x] 2.4 新增命题提取单元测试（9 tests in proposition.test.ts）
- [x] 2.5 验证：npm run typecheck ✅ + npm test ✅

### 第 3 步：编译改造
- [ ] 3.1 listening.ts：compile 读 propRefs 替代 chunkRefs
- [ ] 3.2 prefix.ts：compile prompt 改为命题级输入
- [ ] 3.3 policy.ts：确认逻辑读 propRefs
- [ ] 3.4 改造现有 compile 测试
- [ ] 3.5 验证：chase 有 prop marker → ingest → wiki 节点带 propRefs
- 预算：每任务最多 3 轮

### 第 4 步：审计改造
- [ ] 4.1 semantic-audit-prompt.ts：prop 级锚点 + evidence-anchored 输出
- [ ] 4.2 semantic-audit.ts：读 propRefs，写 auditVerdict 含 anchor 字段
- [ ] 4.3 audit.ts：结构审计检查 propRefs（替代 chunkRefs）
- [ ] 4.4 改造现有审计测试
- [ ] 4.5 验证：audit --semantic → 5 维度 verdict 带 prop 锚点
- 预算：每任务最多 3 轮

### 第 5 步：图谱系统
- [ ] 5.1 新建 knowledge/graph.ts：graph.json 重建 + 读取 + orphan/contradiction 检测
- [ ] 5.2 manifest.ts 升级为 graph builder
- [ ] 5.3 store.ts：rebuildGraph()
- [ ] 5.4 新增图谱单元测试
- [ ] 5.5 验证：wiki 变化 → rebuildGraph → graph.json 有 nodes + edges
- 预算：每任务最多 3 轮

### 第 6 步：Board 改造
- [ ] 6.1 新建 query/search-provider.ts：SearchProvider 接口 + KeywordSearchProvider
- [ ] 6.2 search.ts 改造为实现 SearchProvider 接口
- [ ] 6.3 board.ts：强制注入读 graph.json + propRefs
- [ ] 6.4 改造现有 board 测试
- [ ] 6.5 验证：query --mode challenge → board 包含 counter（强制注入）
- 预算：每任务最多 3 轮

### 第 7 步：qmd 集成
- [ ] 7.1 QmdSearchProvider 实现 SearchProvider 接口
- [ ] 7.2 board.ts：可切换搜索后端
- [ ] 7.3 配置项
- [ ] 7.4 验证：query 用 qmd 搜索 → seedNodes 包含语义关联
- 预算：每任务最多 3 轮

### 第 8 步：LLMProvider 抽象
- [ ] 8.1 LLMProvider 接口（chat/chatWithThinking）
- [ ] 8.2 DeepSeekProvider 实现
- [ ] 8.3 compile/audit/query 调 LLMProvider 不调具体类
- [ ] 8.4 验证：现有功能不变 + 接口可扩展
- 预算：每任务最多 3 轮

### 第 9 步：自进化系统
- [ ] 9.1 新建 evolution/contradiction.ts：矛盾检测
- [ ] 9.2 新建 evolution/supersede.ts：取代确认
- [ ] 9.3 新建 evolution/reflow.ts：回流候选标记
- [ ] 9.4 新建 evolution/reinforce.ts：强化检测
- [ ] 9.5 新建 evolution/confirm.ts：确认管线
- [ ] 9.6 新增自进化单元测试
- [ ] 9.7 验证：矛盾检测 → contradicts 候选 → progress.md 有工单
- 预算：每任务最多 3 轮

### 第 10 步：Daemon
- [ ] 10.1 新建 daemon/index.ts：进程入口
- [ ] 10.2 新建 daemon/watcher.ts：chokidar 文件监听
- [ ] 10.3 新建 daemon/timer.ts：setInterval 定时器
- [ ] 10.4 新建 daemon/state.ts：原子写入状态文件
- [ ] 10.5 新建 daemon/lint.ts：lint 引擎
- [ ] 10.6 新建 daemon/reflow.ts：回流标记
- [ ] 10.7 新建 cli/commands/daemon.ts：daemon 控制命令
- [ ] 10.8 验证：daemon --background → wiki 变化 → 自动 audit → progress.md 更新
- 预算：每任务最多 3 轮

### 第 11 步：OKF 集成
- [ ] 11.1 新建 okf/export.ts
- [ ] 11.2 新建 okf/import.ts
- [ ] 11.3 新建 okf/mapping.ts
- [ ] 11.4 新建 cli/commands/export.ts + import.ts
- [ ] 11.5 验证：export --okf → OKF bundle → import --okf → 走审计管线
- 预算：每任务最多 3 轮

### 第 12 步：端到端验证
- [ ] 12.1 清空 wiki
- [ ] 12.2 新材料 → extract-props → ingest → audit → query → inspire
- [ ] 12.3 daemon 运行 → lint → 矛盾检测 → 回流候选 → 强化候选
- [ ] 12.4 人类确认 → 取代/回流/强化/edge 写入
- [ ] 12.5 验证：发动机完整跑通，wiki 越来越准信号出现
- 预算：最多 5 轮

## 阶段 1 结束判定条件（10 项全满足）

1. [ ] typecheck 0 error
2. [ ] npm run test 全绿
3. [ ] 新材料 → extract-props → chase 有 prop marker
4. [ ] chase 有 prop marker → ingest → wiki 节点带 propRefs
5. [ ] wiki 节点 → audit --semantic → 5 维度 verdict 带 prop 锚点
6. [ ] wiki 节点 → query --mode ask → board 装配 + LLM 回答
7. [ ] graph.json 存在且包含 nodes + edges
8. [ ] daemon 能启动 → 监听文件变化 → 自动触发 audit
9. [ ] 矛盾检测能产出 contradicts 候选 → 写入 progress.md
10. [ ] 人类确认 → 取代/回流/强化/edge 写入 wiki
