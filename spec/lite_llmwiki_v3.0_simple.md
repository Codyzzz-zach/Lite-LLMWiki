# Lite-llmwiki 设计总结 v3.0

---

## 一句话

Human 和 AI 基于同一份 raw 材料逐条对齐认知，只把双方都认可的结晶为 wiki。

## 核心原则

- **一切事实以 raw 为准** — human 不提供新事实，只给方向
- **逐条确认，不同意不落盘** — AI 提 proposition，human 逐条 a/s/m 验证
- **反直觉标注** — 不是挑 raw 的毛病，是提醒 human「这个结论挑战了你的什么习惯认知」

## 已实现的功能

| 功能 | 说明 |
|------|------|
| **MD/PDF 加载** | 读论文、笔记、设计文档 |
| **Brainstorm** | AI 初读 raw，输出主线 + proposition（事实+解读+反直觉标注） |
| **主线选择** | human 选关注方向（短文档 <5 chunks 自动跳过） |
| **逐条确认** | a=对齐 / s=跳过 / m=给角度让 AI 重读 |
| **m 重读** | human 给方向，AI 只读目标 chunk 即时修订 |
| **m 上限 3 次** | 防止死循环 |
| **m 后选版** | 原版 vs 修订版 human 选 |
| **a all 批量** | 一次性确认剩余全部 |
| **Compile** | 已确认 proposition 编译为 wiki 文件 |
| **反直觉视角** | 从已确认 proposition 中收集 counterIntuitive 标注落盘为独立文件 |
| **query 查询** | 关键词搜索 wiki + AI 合成回答 |
| **TUI / CLI** | 两种入口 |
| **缓存设计** | brainstorm 和 compile 共享 system prompt 前缀，compile 时命中缓存 |

## Ingest 流程

```
raw 
  → [load] chunks + 指纹
  → [brainstorm] 主线 + proposition[]（含反直觉标注）
  → [human] 选主线 / 自动全部
  → [逐条确认] a / s / m（限3次）+ a all
  → [compile] 已确认的 → wiki pages
  → [save] raw副本 + wiki文件 + 反直觉文件 + anchor记录
```

## 不需要做的

- SQLite 图谱
- Flash 子代理
- entities/ 目录分离
- 多轮 Listening
- 语义去重
- 多用户

## 待做（按优先级）

1. **compile 篇幅控制** — 短文档输出太短
2. **re-ingest 更新** — 同一材料重新 ingest 覆盖旧 wiki
3. **中断恢复** — 支持 `--resume`
