# lite-llmwiki v4.0 迭代计划

*目标：补齐 llm-wiki 原始设计的必要功能，保持 v3.0 的设计优越性*

---

## 总览

从 llm-wiki 对比中识别出最高优先级的三个缺口：

| 缺口 | Karpathy 原文 | 当前 v3.0 状态 | v4.0 目标 |
|------|-------------|-------------|----------|
| **Cross-page updates** | "a single source might touch 10-15 wiki pages" | 只创建新页面，不更新已有页面 | compile 阶段输出 newPages + updatedPages |
| **index.md** | "a catalog of everything in the wiki" | 无 | 每次 save 后自动生成 |
| **log.md** | "append-only record of what happened" | 无 | 每次 ingest 后追加一行 |

不做 v4.0 的：query 回馈（需要 query 引擎大改）、Lint（wiki 规模不够）。

## 兼容约束

v3.0 设计全部保留：
- brainstorming → 主线选择 → 逐条确认 (a/s/m) → compile 流程不动
- counterIntuitive 标注不动
- 四层前缀缓存不动
- CLI/TUI 双入口不动
- 一切事实以 raw 为准，human 只给方向不动

---

## Phase 1: index.md + log.md

### index.md

**触发时机**: 每次 `store.saveWikiPage()` 之后自动调用。

**生成逻辑**:
```
遍历 wiki/concepts/ 下所有 .md 文件
→ 读取每个文件的 frontmatter (title, confidence, createdAt)
→ 按 category 分组（普通 page / _devils-advocate / anchor）
→ 生成 wiki/index.md
```

**格式**:
```markdown
# Wiki Index

## Concepts (3)
- [karpathy-autoresearch-ai-agents-running](concepts/...md) — 人类写指令AI写代码的分工设计 — 0.9
- [sparsity-allocation](concepts/...md) — 稀疏分配U型定律 — 0.95

## 反直觉视角 (1)
- [反直觉: autoresearch](concepts/_devils-advocate-*.md)

## Anchors (1)
- [核心设计理念](concepts/anchor-*.md)

*Last updated: 2026-05-28T10:00:00Z*
```

**实现**: `KnowledgeStore` 加 `rebuildIndex()` 方法。

### log.md

**触发时机**: ingest 完成后自动追加。

**格式**:
```
## [2026-05-28 10:00] ingest | karpathy-autoresearch
- source: raw/md/karpathy-...md
- anchor: "核心设计理念"
- confirmed: 4/4 propositions
- pages: 3 new, 0 updated
```

只在 `wiki/log.md` 追加，不重写。

---

## Phase 2: Cross-page updates

### 核心挑战

当前 compile 只输出 `newPages[]`。要支持已存在页面的更新，需要：
1. 让 Pro 知道哪些 wiki 页面已经存在，且与新 materia 相关
2. Pro 输出 `updatedPages[]`（修改已有页面）而非只 `newPages[]`

### 设计

**Step 1: 关联检测**（在 compile 之前，不调用 API）

```
对每条 confirmed proposition:
  提取关键词 -> 搜索 wiki/concepts/ 下已有页面的 frontmatter/body
  → 匹配度高的标记为 related
  → 收集 related page 的 filePath + 摘要
```

**Step 2: 编译时注入已有页面上下文**

Compile prompt 中增加：
```
## Existing Wiki Pages (可能需要更新)
- concepts/sparsity-allocation.md: "稀疏分配U型定律..."
- concepts/engram-module.md: "Engram模块架构..."

如果新材料的 proposition 与以上页面有重叠/矛盾/扩展关系，
请输出 updatedPages 来更新这些页面。
```

**Step 3: 输出格式扩展**

```
{
  "newPages": [...],        // 新页面（不变）
  "updatedPages": [         // 新增：要更新的已有页面
    {
      "nodeId": "concepts/sparsity-allocation",
      "filePath": "wiki/concepts/sparsity-allocation.md",
      "updateType": "append" | "replace",  // 追加还是替换
      "body": "## 2026-05-28 更新\n新发现：..."
    }
  ]
}
```

### 已有页面更新策略

| updateType | 行为 | 适用场景 |
|-----------|------|---------|
| `append` (默认) | 在已有 body 末尾追加新节 | 新材料补充了更多证据/案例 |
| 保留 frontmatter | 合并 `related` 字段，不覆盖已有 title/confidence | 防止新 ingest 破坏已有元数据 |

**写回保护**:
- frontmatter 中的 title/source/confidence 保持不变（除非新材料置信度更高）
- `related` 字段合并（去重追加）

---

## Phase 3: 写回保护

已有 wiki 页面的 body 在更新时：
- 原 body 保留
- 新内容以 `## [更新时间] 更新` 节追加
- 不删除原内容（除非 compile 明确标记 replace）

frontmatter 合并规则：
- `title`: 保留原值
- `confidence`: 取 max(原值, 新值)
- `related`: 数组去重合并
- 新增 `lastUpdated` 时间戳

---

## Phase 4: 端到端验证

**测试场景**:
1. 第一次 ingest 材料 A → 3 个 wiki 页面
2. 查看 index.md + log.md 是否正确生成
3. 第二次 ingest 材料 B（与 A 有重叠）→ 确认 updatedPages 是否正确更新了 A 的页面
4. 确认 frontmatter 合并逻辑正确

**成功标准**:
- index.md 列出所有页面
- log.md 有完整的操作记录
- 第二次 ingest 后，材料 A 的页面确实被更新了（新节追加）
- a/s/m 流程全部保留
- counterIntuitive 标注仍然有效

---

## 文件改动清单

| 文件 | 改动 |
|------|------|
| `types.ts` | Compile 输出加 `updatedPages` + `UpdateType` |
| `core/prefix.ts` | Compile prompt 支持 "Existing Wiki Pages" 上下文 |
| `knowledge/store.ts` | + `rebuildIndex()`, + `appendLog()`, + `findRelatedPages()`, 更新 `saveWikiPage` 处理 append 模式 |
| `ingest/listening.ts` | 解析 updatedPages |
| `cli/commands/ingest.ts` | Save 阶段调用 index/log 生成，处理 updatedPages |
| `cli/ui/App.tsx` | 同步 |

## 不做的

- query 回馈 wiki — 不在 v4.0 范围
- Lint 操作 — 不在 v4.0 范围
- 语法去重 (embedding) — 不在 v4.0 范围
- 干扰已有页面的 frontmatter title/confidence — 写回保护
