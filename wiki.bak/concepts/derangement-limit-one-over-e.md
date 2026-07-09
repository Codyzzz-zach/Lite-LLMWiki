---
title: 错位排列的 1/e 极限
source: raw/pdf/e 的基本画像-3ef24c47e940cf85
sourceIds:
  - raw/pdf/e 的基本画像-3ef24c47e940cf85
sourceChase:
  - raw/chase/raw_pdf_e 的基本画像-3ef24c47e940cf85.md
chunkRefs:
  - 1
confidence: 0.9
status: verified
createdAt: "2026-06-11T04:30:50.064Z"
updatedAt: "2026-06-11T04:30:50.072Z"
tags:
  - derangement
  - 1/e
  - 组合数学
kind: concept
nodeId: derangement-limit-one-over-e
auditStatus: warning
auditScore: 1
---

## Claim

n 个元素的随机错位排列（derangement）的概率，当 n → ∞ 时收敛于 1/e ≈ 36.8%。这个收敛速度快到任何实际场景（n > 5）中，全错概率已非常接近 36.8%。

## Evidence

- **Source**: raw/pdf/e 的基本画像-3ef24c47e940cf85 | Chunks: [1]
  - Summary: 错位排列概率收敛到1/e
  > n 个人随机错位排列的概率，随 n → ∞ 收敛于 1/e

## Interpretation

这不是一个需要精心设计的概率——它是「完全混乱」在组合数学中的天然锚点。1/e 是排列群中固定点为零的极限密度。深层洞察：derangement 可以通过容斥原理展开，其概率 = Σ(−1)^k/k!，这正是 e^−1 的泰勒级数截断。1/e 不是「恰好出现」，而是这个无穷级数在极限下的必然归宿。反直觉含义：全错不是边缘事件。36.8% 是相当稳定的概率——这意味着即使只有 5 个人随机构造，全错的概率已经接近 37%（5 个人全错的实际概率约为 36.67%）。

## Use For

- 基线测试：任何声称「随机分配后很少出错」的系统，如果全错率显著偏离 36.8%，说明分配过程存在系统性偏差（如人为干预、配对偏好）。
- 教育：作为容斥原理和泰勒级数的桥梁案例，展示离散组合与连续分析之间的自然连接。

## Limits

- 仅适用于「无约束随机配对」场景。如果排列空间被限制（如男女性别分开配对），概率发生变化。
- n 很小时概率不是 1/e（n=1 时全错概率为 0，n=2 时为 1/2），需要 n > 5 才接近稳定。
