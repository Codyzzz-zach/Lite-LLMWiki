/**
 * cli-llm-init — CLI 包装层共享的 LLM 初始化逻辑
 *
 * 把 "读 API key → 构造 DeepSeekClient → 生成 llmJudge/llmCaller" 模式
 * 从三个命令（audit / query / inspire）中提取为共享函数，
 * 遵循与 ingest 一致的初始化路径。
 *
 * 核心逻辑层（engine）通过 llmJudge/llmCaller 参数注入，
 * 不直接依赖 CLI 层的 config/apiKey — 保持可测试。
 *
 * 本产品必须有 LLM API key 才能运行。无 key 时直接抛错。
 */
import { loadApiKey } from "../config.js";
import { DeepSeekClient } from "../core/client.js";
import {
	AUDIT_SYSTEM_PROMPT,
	INSPIRE_SYSTEM_PROMPT,
	makeDeepSeekCaller,
} from "../query/engine.js";
import type { AppConfig, QueryBoard } from "../types.js";

function requireApiKey(): string {
	const apiKey = loadApiKey();
	if (!apiKey) {
		throw new Error(
			"DEEPSEEK_API_KEY not set — this product requires an API key. " +
				"Set it via environment variable or .env file.",
		);
	}
	return apiKey;
}

// ─── LLM Judge（用于 semantic audit）───────────────────────────────

/**
 * 从 .env / 环境变量加载 API key 并构造 llmJudge。
 * 无 key 时抛错（本产品必须有 key）。
 */
export function tryMakeLlmJudge(
	config: AppConfig,
): (prompt: string) => Promise<string> {
	requireApiKey();

	const client = new DeepSeekClient(config);
	return async (prompt: string) =>
		client
			.chat({
				model: config.model,
				systemPrompt: AUDIT_SYSTEM_PROMPT, // ✅ 使用 audit system prompt
				messages: [{ role: "user", content: prompt }],
			})
			.then((r) => r.content);
}

// ─── LLM Caller（用于 query / inspire）─────────────────────────────

export interface LlmCallerResult {
	answer: string;
	usage?: { promptTokens: number; completionTokens: number } | null;
	modelSynthesis?: unknown[];
}

/**
 * 从 .env / 环境变量加载 API key 并构造 llmCaller（DeepSeek chat）。
 * 无 key 时抛错（本产品必须有 key）。
 *
 * makeDeepSeekCaller 是 query/engine.ts 的工厂，
 * 这里直接使用以保持 prompt 构造的一致性。
 */
export function tryMakeLlmCaller(
	config: AppConfig,
): (board: QueryBoard, question: string) => Promise<LlmCallerResult> {
	requireApiKey();

	return makeDeepSeekCaller(config);
}

/**
 * 构造 inspire 专用的 LLM caller。
 *
 * 与 tryMakeLlmCaller 的区别：
 * - 使用 INSPIRE_SYSTEM_PROMPT（要求 JSON 数组输出）
 * - responseFormat="json_object" 强制 JSON 输出
 *
 * 无 key 时抛错（本产品必须有 key）。
 */
export function tryMakeInspireCaller(
	config: AppConfig,
): (board: QueryBoard, question: string) => Promise<LlmCallerResult> {
	requireApiKey();

	return makeDeepSeekCaller(config, undefined, {
		systemPrompt: INSPIRE_SYSTEM_PROMPT,
		responseFormat: "json_object",
	});
}
