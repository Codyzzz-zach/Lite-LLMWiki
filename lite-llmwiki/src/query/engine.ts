import type { AppConfig } from "../types.js";
import { KnowledgeStore } from "../knowledge/store.js";
import { DeepSeekClient } from "../core/client.js";

export interface QueryOptions {
  question: string;
  config: AppConfig;
  signal?: AbortSignal;
}

export interface QueryResult {
  answer: string;
  sourcePages: Array<{ filePath: string; title: string }>;
  usage: {
    promptTokens: number;
    completionTokens: number;
  } | null;
}

const QUERY_SYSTEM_PROMPT = `你是 lite-llmwiki 的知识查询助手。你的职责是基于用户已经编译的知识库 wiki 来回答问题。

规则：
1. 只基于下面给出的 wiki 内容回答
2. 如果 wiki 内容不足以回答问题，如实说"知识库中目前没有足够的信息来回答这个问题"
3. 引用来源时标注对应的 wiki 文件名
4. 不要编造不存在的事实
5. 回答用中文`;

/**
 * Query Engine
 *
 * 流程：
 * 1. 用关键词搜索 wiki 文件
 * 2. 读取匹配的 wiki 页面内容
 * 3. 将问题 + wiki 内容发给模型合成回答
 */
export async function queryKnowledge(opts: QueryOptions): Promise<QueryResult> {
  const { question, config, signal } = opts;

  const store = new KnowledgeStore(config);
  const client = new DeepSeekClient(config);

  // 1. 搜索相关 wiki 页面
  const results = store.searchWikiPages(question);
  const sourcePages = results.slice(0, 10);

  if (sourcePages.length === 0) {
    return {
      answer: "知识库中目前没有找到与问题相关的页面。",
      sourcePages: [],
      usage: null,
    };
  }

  // 2. 读取 wiki 内容
  const wikiContents: string[] = [];
  for (const page of sourcePages) {
    const content = store.readWikiPage(page.filePath);
    if (content) {
      wikiContents.push(`--- ${page.filePath} ---\n${content}`);
    }
  }

  // 3. 组装查询
  const wikiBlock = wikiContents.join("\n\n");
  const userMessage = `## 用户问题\n${question}\n\n## 知识库中相关内容\n${wikiBlock}\n\n请基于以上 wiki 内容回答问题，并注明引用来源。`;

  const result = await client.chat({
    model: config.model,
    systemPrompt: QUERY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    signal,
  });

  return {
    answer: result.content,
    sourcePages,
    usage: result.usage
      ? {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
        }
      : null,
  };
}
