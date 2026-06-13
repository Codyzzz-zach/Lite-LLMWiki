/**
 * cli-llm-init — CLI 包装层共享的 LLM 初始化逻辑
 *
 * 把 "读 API key → 构造 DeepSeekClient → 生成 llmJudge/llmCaller" 模式
 * 从三个命令（audit / query / inspire）中提取为共享函数，
 * 遵循与 ingest 一致的初始化路径。
 *
 * 核心逻辑层（engine）通过 llmJudge/llmCaller 参数注入，
 * 不直接依赖 CLI 层的 config/apiKey — 保持可测试。
 */
import { loadApiKey } from "../config.js";
import { DeepSeekClient } from "../core/client.js";
import { makeDeepSeekCaller, INSPIRE_SYSTEM_PROMPT } from "../query/engine.js";
import type { AppConfig, QueryBoard } from "../types.js";

// ─── LLM Judge（用于 semantic audit）───────────────────────────────

/**
 * 尝试从 .env / 环境变量加载 API key 并构造 llmJudge。
 * 返回 null 表示无可用 key（语义 audit 将走 spec 7.7 failure path）。
 */
export function tryMakeLlmJudge(config: AppConfig): ((prompt: string) => Promise<string>) | null {
  const apiKey = loadApiKey();
  if (!apiKey) return null;

  const client = new DeepSeekClient(config);
  return async (prompt: string) =>
    client.chat({
      model: config.model,
      systemPrompt: "",
      messages: [{ role: "user", content: prompt }],
    }).then((r) => r.content);
}

// ─── LLM Caller（用于 query / inspire）─────────────────────────────

export interface LlmCallerResult {
  answer: string;
  usage?: { promptTokens: number; completionTokens: number } | null;
  modelSynthesis?: unknown[];
}

/**
 * 尝试从 .env / 环境变量加载 API key 并构造 llmCaller（DeepSeek chat）。
 * 返回 null 表示无可用 key（将走 board-only 模式）。
 *
 * makeDeepSeekCaller 是 query/engine.ts 的工厂，
 * 这里直接使用以保持 prompt 构造的一致性。
 */
export function tryMakeLlmCaller(config: AppConfig): ((board: QueryBoard, question: string) => Promise<LlmCallerResult>) | null {
  const apiKey = loadApiKey();
  if (!apiKey) return null;

  return makeDeepSeekCaller(config);
}

/**
 * 尝试构造 inspire 专用的 LLM caller。
 *
 * 与 tryMakeLlmCaller 的区别：
 * - 使用 INSPIRE_SYSTEM_PROMPT（要求 JSON 数组输出）
 * - responseFormat="json_object" 强制 JSON 输出
 *
 * 返回的 caller 签名与 tryMakeLlmCaller 一致，
 * 但 answer 字段包含 JSON 数组字符串（可被 parseInspireItems 解析）。
 */
export function tryMakeInspireCaller(config: AppConfig): ((board: QueryBoard, question: string) => Promise<LlmCallerResult>) | null {
  const apiKey = loadApiKey();
  if (!apiKey) return null;

  return makeDeepSeekCaller(config, undefined, {
    systemPrompt: INSPIRE_SYSTEM_PROMPT,
    responseFormat: "json_object",
  });
}