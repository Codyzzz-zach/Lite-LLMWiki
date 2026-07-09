# llm-wiki 原始设计 vs lite-llmwiki v3.0 对比评估

*基于 Karpathy 的 [llm-wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 进行逐项对比*

---

## 一、完全符合原始设计的

### 三层架构
| Karpathy | 我们 |
|----------|------|
| Raw sources — 不可变，LLM 只读 | `raw/md/` — 原始材料副本，fingerprint 去重 |
| Wiki — LLM 生成的 Markdown | `wiki/concepts/` — Pro 编译的 `.md` 文件 |
| Schema — 告诉 LLM 结构约定的文档 | `core/prefix.ts` 中的 system prompt（Workspace Rules） |

### 人类角色
| Karpathy | 我们 |
|----------|------|
| "Human's job: curate sources, direct analysis, ask good questions" | Human 选材料 + 给 anchor + 逐条 a/s/m + 给 m 角度 |
| "You never write the wiki yourself — the LLM writes all of it" | Human 从不写 wiki body，只做确认 |

### 知识积累模式
| Karpathy | 我们 |
|----------|------|
| "The wiki is a persistent, compounding artifact" | wiki 文件持久化到磁盘，每次 ingest 追加新页面 |
| "Knowledge is compiled once and kept current" | brainstorm → compile → 落盘，不重复推导 |

### 人类在 ingest 时 stay involved
| Karpathy | 我们 |
|----------|------|
| "I read the summaries, check the updates, and guide the LLM on what to emphasize" | 逐条 a/s/m 确认，每条 proposition 必须 human 点头才落盘 |
| "Ingest sources one at a time and stay involved" | 一次 ingest 一个文件 |

### 证据链路
| Karpathy | 我们 |
|----------|------|
| "All facts trace back to raw sources"（隐含） | 每条 proposition 标注 chunkRefs，claim 只来自 raw |

---

## 二、我们自己加的设计（不在原始设计中）

| 设计 | 说明 | 评估 |
|------|------|------|
| **Proposition 模型** | claim + aiReading + counterIntuitive | ✅ 把模糊的 "discuss key takeaways" 结构化，降低 human 确认门槛 |
| **逐条确认 (a/s/m)** | 每条 proposition 必须 human 验证后才落盘 | ✅ 强制 human stay involved，避免 AI 自动乱写 |
| **m 模式 reread** | human 给新角度，AI 只重读目标 chunk | ✅ 在 human 主导方向的同时保持 raw 作为唯一事实源 |
| **a all 批量** | human 觉得 OK 可以一键确认剩余 | ✅ 降低体力成本，不牺牲 human 主权 |
| **反直觉标注 (counterIntuitive)** | 提醒 human "这个结论挑战了你的习惯" | ✅ 制造认知摩擦，完全在 human 的确认范围内 |
| **四层前缀缓存** | brainstorm/compile 共享 system prompt | ✅ Karpathy 没提但符合低成本设计哲学 |

---

## 三、原始设计有、我们还没有的

| Karpathy 的设计 | 我们状态 | 重要性 |
|-----------------|---------|--------|
| **index.md** — 所有 wiki 页面的目录清单 | 未实现 | 🔴 高。wiki 页面多了之后，human 需要知道有什么 |
| **log.md** — 追加式操作日志 | 未实现 | 🟡 中。有人会需要追溯 "什么材料什么时间 ingest 的" |
| **单一 ingest 更新 10-15 个已有页面** | 未实现。每次编译只创建新页面，不更新旧页面 | 🔴 高。这是 "compounding artifact" 的核心——旧知识要和新知识融合 |
| **query 结果存回 wiki** | 未实现。query 是一次性回答 | 🟡 中。"Good answers should be filed back" |
| **Lint 操作** | 未实现 | 🟢 低。wiki 规模没到需要自动健康检查的程度 |
| **跨文件 cross-reference** | frontmatter 有 `related` 字段可用，但 compile 阶段不自动补 | 🟡 中。Karpathy 说 "cross-references are already there" |

---

## 四、我们的设计方向是否偏离了原始哲学？

### 没有偏移

原始哲学的核心三句话，我们全部遵守：

> "The wiki is a persistent, compounding artifact."

✅ wiki 文件持久化，每次 ingest 追加新条目。

> "You never write the wiki yourself — the LLM writes and maintains all of it."

✅ Human 从不写 wiki body，只做 a/s/m 确认。

> "The human's job is to curate sources, direct the analysis, ask good questions."

✅ Human 选材料、给 anchor、逐条选 a/s/m、给 m 方向。

### 有偏移但合理

Karpathy 说的 "discusses key takeaways with you" 是开放式对话，我们把它结构化成了 a/s/m checklist。这是**收敛性偏移**，不是方向性偏移——降低了 human 的认知负担（"看着选项点"而不是"想说什么"），但保持了 human 的主权（不点头不落盘）。

### 有缺失

最大的缺失是 **cross-page updates**——Karpathy 明确说 "a single source might touch 10-15 wiki pages"，我们的 compile 阶段只创建新页面，不更新已有页面。这意味着 wiki 不会"compounding"——每次 ingest 是独立的，旧知识和新知识不交叉。

---

## 五、自评估

| 维度 | 得分 | 说明 |
|------|------|------|
| 三层架构 | 9/10 | 完全匹配。raw/wiki/schema 三条线清晰 |
| 人类角色 | 9/10 | 比原始设计更结构化地保障了 human 主权 |
| 知识 compounding | 5/10 | 新页面能写，但旧页面不会融合新知识 |
| LLM 写 wiki | 9/10 | 完全符合 |
| 导航/索引 | 3/10 | index.md 和 log.md 都缺失 |
| 查询 compound | 2/10 | query 不回馈到 wiki |
| 务实简洁 | 9/10 | ~1600 行 TS，零原生依赖，非常 Karpathy 风格 |
| **整体** | **7/10** | 核心哲学一致，但在 "compounding" 上差最大 |

### 下一步最重要的事

**跨页面更新** — 这是 Karpathy 说 "the wiki gets richer with every source" 的底层机制。没有它，wiki 只是一个文档集合，不是真正的 compounding artifact。
