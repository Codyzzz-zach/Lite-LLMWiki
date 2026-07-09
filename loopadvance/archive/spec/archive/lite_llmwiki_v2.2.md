# lite-llmwiki 设计说明书 v2.2

DeepSeek-native 终端知识工作台 — THC 工作流 + 认知方法论落地

---

## 变更摘要（v2.1 → v2.2）

| 变更 | v2.1 | v2.2 |
|------|------|------|
| Pro 元指令 | "冷静、主动倾听" | **+三步降维路径 + 制造摩擦 + THC Hypothesis 输出** |
| Pro 输出结构 | facts + alignment + feedback | **+ devilsAdvocate + hypotheses[2-3]** |
| 人机交互 | 单向（AI 独白 → 用户看） | **THC：Trigger → Hypothesis（选择菜单）→ Confirm（结晶）** |
| wiki 页面性质 | 静态真理 | **标注为"某次视角的快照"，每次 query 可重新渲染** |
| AI 人格 | 冷静倾听者 | **认知陪练：既要对齐又要制造反直觉摩擦** |
| 上一步 v2.1 代码 | — | **零推翻，仅扩展字段 + 加一个选择组件** |

---

## 第一章：认知方法层（注入 System Prompt）

### 1.1 三步降维路径

Pro Listening 在处理任何 Raw 材料时，必须遵循以下思维路径：

```
1. 拆解拆分（还原论）
   把材料视为一组独立、正交的基本单元的集合。
   处理前先识别单元边界：哪几个概念是不可再分的原子？
   
2. 无损替换（同构映射）
   穿透表象，寻找结构等价物。
   例：这本书的论点结构 → 可以用什么已知框架（如苏格拉底对话、
   费曼学习法、MECE 原则）等价表达？
   
3. 有损近似（工程实用）
   如果材料中某些部分无法完全确定（前提缺失、样本不足、
   作者语焉不详），声明你的假设前提，给出带误差的近似结论。
   标注为 "low confidence"。
```

这条路径**不是一条顺序管道**，而是每一轮 Listening 时 Pro 对自己输出的**自检清单**：每个 fact 是否找到了它在材料中的原子位置（拆解），是否找到了可映射的已知结构（替换），是否为不确定性标注了前提（近似）。

### 1.2 角色约束：制造摩擦 (Devil's Advocate)

**规则**：Pro **必须**在输出中包含至少一个 `devilsAdvocate` 视角——对材料本身的假设、缺失变量、样本偏差、逻辑跳跃提出质疑。

摩擦不是否定材料，而是**为人类提供另一种视角**，防止信息茧房。

**例**：
```
材料声称: "Graph-RAG 比 baseline RAG 高出 15-20%"
摩擦视角:  "如果 baseline RAG 的参数选择是有意弱化的，或测试集偏向
           图结构场景，这 15-20% 可能被高估。本条是推理性质，置信度 low。"
```

摩擦视角标注为 `confidence: "low"` ——它是推理，不是事实。

### 1.3 禁止开放式问题

Pro **不可以**向用户抛出"你认为呢？""还有其他需要吗？""你觉得这样对吗？"

代替方案：**给出 2-3 个结构化的认知映射假设（Hypothesis）**，让用户做**选择题**而非**论述题**。

---

## 第二章：THC 三步工作流

### 2.1 Trigger（极简触发）

用户提供：
- **Raw**：文件路径/URL（必填）
- **Anchor**：一句直觉、问题或痛点（可选，但推荐）

这和 v2.1 一致。新增：`purpose.md` 作为全局视角过滤器，Pro 在 reading 阶段参考。

### 2.2 Hypothesis（智能试探，替代 feedbackText 独白）

**核心变化**：Pro 不再输出一段独白反馈，而是输出**2-3 个结构化的认知映射假设**。

每个 Hypothesis 的结构：

```typescript
interface HypothesisOption {
  id: "A" | "B" | "C";
  title: string;           // 映射方向，如 "映射到方法论"
  relevantFacts: string[]; // 关联的 fact ID
  logic: string;           // 为什么这个映射成立（3-5 句）
  actionability: string;   // 可选：这个视角导向什么行动？
}
```

**Hypothesis 的三种默认映射方向**（Pro 可以自由组合，但至少含 2 种）：

| 方向 | 含义 | 示例 |
|------|------|------|
| **方法论映射** | 材料的原理/方法是否能直接用于当前项目？ | "这篇文章的 Graph Indexing 方法可以直接用于老项目的代码依赖图构建" |
| **认知反转** | 材料是否挑战了已有认知？是否存在常识盲区？ | "你之前认为多跳 RAG 就是多轮检索——本文指出图结构才是关键，检索只是执行层" |
| **结构补全** | 材料填补了已有知识的什么空白？ | "你的知识库中有 RAG 概念但没有 RAG 性能基准——本文补上了 baseline 对比数据" |

**输出格式（追加到 ListeningResult JSON）**：

```json
{
  "devilsAdvocate": "对材料的反直觉质疑...",
  "hypotheses": [
    {
      "id": "A",
      "title": "映射到方法论",
      "relevantFacts": ["graph-indexing", "graph-retrieval"],
      "logic": "论文的 Graph Indexing 方法可以...",
      "actionability": "可在项目 X 的依赖分析模块中实现"
    },
    {
      "id": "B",
      "title": "认知反转",
      "relevantFacts": ["graph-rag-concept", "performance"],
      "logic": "你之前认为...但本文指出...",
      "actionability": "重新评估现有 RAG 方案的图检索部分"
    }
  ]
}
```

### 2.3 Confirm（锁扣定型）

**TUI 渲染**（新组件 `HypothesisPicker`）：

```
  📝 Pro 已完成倾听。选择一个认知映射方向：

  [A] 映射到方法论
      论文的 Graph Indexing 方法可以直接用于老项目的代码依赖图构建
      → 涉及: graph-indexing, graph-retrieval

  [B] 认知反转
      你之前认为多跳 RAG 就是多轮检索——本文指出图结构才是关键
      → 涉及: graph-rag-concept, performance

  [C] 结构补全
      知识库中 RAG 概念缺少性能基准——本文补上了 baseline 对比数据
      → 涉及: performance, limitation

  ❯ 选择 A/B/C（或按 Enter 选 A）
```

用户按键选择后：

1. **选中的 Hypothesis 作为"当前视角"传给 Flash Compiler**
2. Flash 以这个视角为重排 wiki 页面、标注关联、生成 intro
3. 所有页面在 frontmatter 中记录：
   ```
   hypothesis: B
   hypothesis_title: 认知反转
   ```
4. Anchor 节点入图，relation_type = `"confirmed_hypothesis"` 连接 anchor → 对应 Hypothesis 的 fact 节点
5. devilsAdvocate 作为单独的 `concept` 节点存入 wiki（`wiki/concepts/_devils-advocate-<hash>.md`），供未来查询时发现

### 2.4 CLI 模式的 THC

当用户通过 CLI（非 TUI）执行 `llmwiki ingest` 时：
- Pro 仍输出 hypotheses[3] 和 devilsAdvocate
- 系统自动选择 Hypothesis A（默认）
- devilsAdvocate 存入 wiki
- 终端打印三个选项供用户后续用 `:select` 命令切换

---

## 第三章：交互层变更

### 3.1 TUI 命令新增

| 命令 | 作用 |
|------|------|
| `:select A\|B\|C` | 在 Hypothesis 阶段重新选择映射方向，触发 Compiler 重新渲染 |
| `:mode friction` | 开启/关闭 devilsAdvocate 显示 |
| `:mode hypothesis` | 切换当前材料的不同 Hypothesis 视图 |

`:select` 的加入意味着同一个 raw 材料可以**有多个 wiki 视图**，对应不同的 Hypothesis。这些视图存为 wiki 文件的不同版本或不同 frontmatter 标记。

### 3.2 CLI 新增选项

```bash
llmwiki ingest paper.pdf -m "anchor" --hypothesis B     # 直接指定映射方向
llmwiki query "..." --hypothesis B                       # 以指定视角查询
llmwiki node <id> --hypotheses                           # 列出该节点关联的所有 Hypothesis
```

---

## 第四章：数据层变更

### 4.1 ListeningResult 扩展

```typescript
export interface HypothesisOption {
  id: "A" | "B" | "C";
  title: string;
  relevantFacts: string[];
  logic: string;
  actionability?: string;
}

// ListeningResult 加:
{
  devilsAdvocate: string | null;       // 制造摩擦：反直觉视角
  hypotheses: HypothesisOption[];      // 2-3 个认知映射假设
  selectedHypothesis?: string;         // 用户选择的（A/B/C），可选
}
```

### 4.2 WikiPage frontmatter 扩展

```yaml
---
id: graph-indexing
type: concept
confidence: high
hypothesis: B                # 被哪个 Hypothesis 选中
hypothesis_title: 认知反转
selected_at: 2026-05-26T08:00:00Z
devils_advocate: "..."       # 可选，仅在首次编译时写入
---
```

### 4.3 edges 表新增关系类型

```sql
ALTER TABLE edges ADD CHECK(relation_type IN (
  'supports','challenges','extends','depends_on','contradicts',
  'supersedes','uses','source_of',
  'confirmed_hypothesis',   -- anchor → fact（用户选择了这个映射）
  'alternative_hypothesis'  -- anchor → fact（备选映射，未选中）
));
```

注意：`confirmed_hypothesis` 和 `alternative_hypothesis` 是扩展 relation_type，不改现有的任何边。SQLite 的 CHECK 约束需要重建。

### 4.4 存储示意图

```
raw/pdf/paper.pdf ──[source_of]──→ concept/graph-rag  ──[confirmed_hypothesis]──→ anchor-abc
                                      │
                                      ├──[alternative_hypothesis]──→ anchor-abc (备选)
                                      │
                                  wiki/concepts/graph-rag.md
                                  (hypothesis: B, 认知反转视角)
```

---

## 第五章：System Prompt 修订（核心文本）

### 5.1 Pro Listening System Prompt（完整版）

```
你是 lite-llmwiki 的"认知陪练引擎"。你的角色不是友善的助教，而是冷静、
洞察原材料结构、敢于提出反直觉视角的 sparring partner。

# 认知方法（处理每份材料时的自检清单）
1. 拆解拆分：这份材料由哪些正交的基本单元构成？先找原子单元边界。
2. 无损替换：这份材料的论证结构可以用什么已知框架等价表达？
3. 有损近似：如果有不确定的部分，声明你的假设前提，标注为 low confidence。

# 输出要求
输出必须是严格的 JSON。顶层字段：
- facts: 从材料中提取的原子知识单元（概念/实体）
- alignment: anchor 与 facts 的对齐关系
- devilsAdvocate: 对材料的反直觉质疑（必须输出，至少一句）
- hypotheses: 2-3 个认知映射假设（你的核心输出来到这里）
- openQuestions: 材料中未回答的问题

# 制造摩擦 (Devil's Advocate)
你不可以只是附和材料。必须找到至少一个作者可能忽略的前提、
样本偏差、逻辑跳跃或过度推广，并给出明确的推理，标注 confidence:"low"。

# THC 假设输出 (Hypothesis Generation)
不输出独白反馈。输出 2-3 个结构化的认知映射假设，让用户做选择题。
每个假设包含：
- id: "A" | "B" | "C"
- title: 映射方向（方法论映射 / 认知反转 / 结构补全）
- relevantFacts: 关联的 fact ID 列表
- logic: 为什么这个映射成立（3-5 句）
- actionability: 这个视角导向什么行动（可选）

# 禁止
- 禁止向用户提出开放式问题（"你认为呢？"、"还有其他吗？")
- 禁止编造不存在的证据位置
- 禁止在 devilsAdvocate 中做人身攻击或价值判断——只质疑方法和逻辑
```

### 5.2 Flash Compiler System Prompt（修订版）

```
你是 lite-llmwiki 的 wiki 编译器。接收 ListeningResult + 用户选择的 Hypothesis。

# 编译规则
1. 以用户选择的 Hypothesis 视角为 wiki 排序
   — 与该 Hypothesis 直接相关的 facts 排在页面最前面
2. 为每个 fact 生成 Markdown wiki
   — frontmatter 中标注 hypothesis 和 hypothesis_title
3. devilsAdvocate（如果存在）作为独立的 _devils-advocate-<hash> 概念节点写入
4. 生成 edges：source_of / confirmed_hypothesis / alternative_hypothesis

# 只输出 JSON
```

---

## 第六章：与 v2.1 的兼容性

| 模块 | v2.1 | v2.2 | 改动性质 |
|------|------|------|---------|
| Source / Loader | ✅ | ✅ 不变 | — |
| Prefix cache | ✅ | ✅ 不变 | — |
| Pro Listening | ✅ | ✅ 扩展字段 | ListeningResult 加 3 个可选字段 |
| Flash Compiler | ✅ | ✅ 加 Hypothesis 参数 | 新参数可选 |
| KnowledgeStore | ✅ | ✅ 不变 | edges CHECK 约束需 migration |
| CLI commands | ✅ | ✅ 加 --hypothesis 选项 | 向后兼容 |
| TUI | ✅ | ✅ 加 HypothesisPicker | 新组件 |
| Types | ✅ | ✅ 加 3 个接口 | 新增非替换 |

---

## 第七章：实施路线

### phase 1: 设计落地（本文档 + AGENT_CONTRACT）
✅ 当前

### phase 2: 类型 + Prompt 先行

| 文件 | 动作 |
|------|------|
| `src/types.ts` | 加 HypothesisOption、extend ListeningResult |
| `src/core/prefix.ts` | 重写 PRO_LISTENING_SYSTEM（含三步降维 + 摩擦 + THC）|
| `AGENT_CONTRACT.md` | 加摩擦条款和禁止开放式问题条款 |

### phase 3: 引擎修改

| 文件 | 动作 |
|------|------|
| `src/ingest/listening.ts` | 解析 devilsAdvocate 和 hypotheses |
| `src/ingest/compiler.ts` | 加 selectedHypothesis 参数 |
| `src/knowledge/graph.ts` | edges CHECK 约束加 2 个新关系类型 |

### phase 4: 交互

| 文件 | 动作 |
|------|------|
| `src/cli/ui/HypothesisPicker.tsx` | 新建：A/B/C 选择组件 |
| `src/cli/ui/App.tsx` | TUI 流程：Listening → HypothesisPicker → Compiler |
| `src/cli/commands/ingest.ts` | CLI 加 `--hypothesis` 和 `--select` 选项 |

### phase 5: v2.2 spec 与 code 对照 review

---

*本文档基于白皮书 V1.0 迭代。*  
*下一步：按 phase 2-4 逐阶段实现。*
