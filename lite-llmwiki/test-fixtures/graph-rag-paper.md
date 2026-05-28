---
title: "Graph-RAG 论文笔记"
author: "mixi"
date: 2025-06-01
tags: graph-rag, ai
---

# Graph-RAG for Long Context

## 核心思想

Graph-RAG 是在图结构上进行检索和推理的 RAG 变体。与传统的向量 RAG 不同，Graph-RAG 将知识表示为图结构，支持多跳推理和更复杂的查询。

## 方法

论文提出了两个主要贡献：

1. Graph Indexing：将文档构建为知识图谱
2. Graph Retrieval：在图上执行多跳检索

## 实验结果

在多个长文本基准测试中，Graph-RAG 比 baseline RAG 高出 15-20%。

## 局限

论文没有清楚讨论图更新时的一致性问题。
