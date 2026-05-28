# lite-llmwiki

DeepSeek-native 终端知识工作台。

在一个终端 CLI 内，支持 markdown 一键摄取 + 一句人类直觉 + 主动倾听理解 + 自动编译成 wiki + 图谱查询。

## 快速开始

```bash
# 安装
npm install -g lite-llmwiki

# 设置 API key
export DEEPSEEK_API_KEY=sk-xxx

# 摄入一篇 markdown
llmwiki ingest paper.md -m "这篇是怎么处理多跳 graph RAG 的？"

# 查询知识
llmwiki query "和我之前那篇 RAG 论文有什么冲突？"
```

## 开发

```bash
npm install
npm run build
npm run ingest -- README.md -m "测试摄入"
```

## 架构

```
ingest → SourceLoader → ProListening → FlashCompiler → wiki/ + SQLite
                                                              ↓
query  ←  QueryEngine  ←  Pro 理解意图  ←  图谱检索  ←──────┘
```

详见 [spec/lite_llmwiki_v2.1.md](spec/lite_llmwiki_v2.1.md)。
