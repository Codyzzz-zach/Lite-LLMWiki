---
title: 独立伯努利试验的零成功极限
source: raw/pdf/e 的基本画像-3ef24c47e940cf85
sourceIds:
  - raw/pdf/e 的基本画像-3ef24c47e940cf85
sourceChase:
  - raw/chase/raw_pdf_e 的基本画像-3ef24c47e940cf85.md
chunkRefs:
  - 2
confidence: 0.9
status: verified
createdAt: "2026-06-11T04:30:50.072Z"
updatedAt: "2026-06-11T04:30:50.072Z"
tags:
  - 伯努利
  - 1/e
  - 概率论
kind: concept
nodeId: bernoulli-zero-success-limit
auditStatus: passed
auditScore: 1
---

## Claim

进行 n 次独立试验，每次成功概率 p = 1/n，则「n 次全部失败」的概率当 n → ∞ 时收敛于 1/e。

## Evidence

- **Source**: raw/pdf/e 的基本画像-3ef24c47e940cf85 | Chunks: [2]
  - Summary: 伯努利试验零成功概率收敛到1/e
  > 做 n 次独立伯努利试验，每次成功概率 = 1/n，则 n 次全都不成功的概率收敛于 1/e

## Interpretation

这是 (1 − 1/n)^n → 1/e 的直接体现，但这个极限的深层结构在于：你把总量为 1 的「成功配额」稀释到越来越多的机会上，最后「一次都不中」的概率稳定在 ~37%——与机会数量无关，只要机会多且每次概率成比例缩小。关键洞察：这建立了一个「机会数量」与「单次概率」之间的缩放对偶。如果你有 100 次机会、每次概率 1%，和 10000 次机会、每次概率 0.01%，「全不中」的概率都接近 37%。与 derangement 的关系：derangement 的概率等于包含-排除公式的截断级数，该级数恰好是 e^−1 的泰勒展开。伯努利极限则是 (1 − 1/n)^n 的结构。两者数学上不同（一个是级数截断，一个是极限过程），但收敛于同一常数。

## Use For

- 稀有事件分析：在大量独立稀有事件叠加的系统中（如设备故障、罕见基因突变），「一段时间内完全没有事件发生」的基线概率可近似为 37%，前提是事件独立且总期望为 1。
- 秘书问题的概率锚点：1/e 作为最优成功概率正是从这一结构推导出来的。

## Limits

- 必须满足「n 大、p 小、np=1 固定」的泊松极限条件。如果 np 偏离 1，极限概率不是 1/e。
- 独立性假设必须成立。如果各次试验相关（如连锁故障），该基线不适用。
