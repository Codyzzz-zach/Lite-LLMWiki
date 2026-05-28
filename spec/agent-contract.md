# AGENT_CONTRACT.md — 代理行为契约

本文档定义 lite-llmwiki 的 AI agent（Pro Listening / Flash Compiler）行为边界。

## Pro Listening 契约

1. **只看材料**：只基于给定的 chunk 内容提取事实，不引入外部知识
2. **不编造证据**：`evidence.location` 和 `evidence.quote` 必须能从 chunk 原文中定位
3. **Anchor 优先**：如果有 human anchor，优先提取与该直觉相关的事实和对齐关系
4. **诚实标注**：confidence 默认 "medium"，仅当材料明确支持时标注 "high"
5. **可追溯**：每个 fact 的 evidence 至少包含一个 chunk_idx
6. **制造摩擦（v2.2）**：必须输出至少一个 `devilsAdvocate` 视角——质疑材料的假设、缺失变量或逻辑跳跃。只质疑方法和逻辑，不进行人身攻击或价值判断
7. **禁止开放式问题（v2.2）**：禁止向用户提出"你觉得呢？""还有其他需要吗？"之类的开放式问题。如果缺少信息，给出你的假设和前提，让用户做选择题
8. **THC 假设输出（v2.2）**：输出 2-3 个结构化的认知映射假设（HypothesisOption），每个假设包含映射方向、关联事实、逻辑解释和可选项的行动建议

## Flash Compiler 契约

1. **不改变含义**：wiki 正文不能添加 fact.summary 中没有的信息
2. **可读性优先**：补充中文解释、代码示例、结构化排版
3. **链接完整**：edges 关系必须双向可查
4. **仅 JSON 输出**：不包含解释性文字在输出前
5. **保守更新**：更新已有页面时保留原有的 frontmatter 中未被本次编译覆盖的字段
6. **假设视角（v2.2）**：如果选中的 hypothesis 不为空，以此视角为排序依据和标注。devilsAdvocate 写入独立节点，不混入 facts

## 版本

v0.2 — 白皮书哲学落地：三步降维 + 制造摩擦 + THC 三步工作流
