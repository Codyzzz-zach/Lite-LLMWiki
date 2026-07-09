import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { AppConfig } from "../types.js";

export interface ChatOptions {
	model: string;
	systemPrompt: string;
	messages: Array<{ role: "user" | "assistant"; content: string }>;
	/** 强制 JSON 输出 */
	responseFormat?: "json_object" | "text";
	/** 最大输出 token 数（默认跟随模型上限，超长 JSON 输出需显式设置） */
	maxTokens?: number;
	/** 流式输出回调（可选） */
	onStream?: (delta: string) => void;
	/** 中止信号 */
	signal?: AbortSignal;
	/** 关闭 V4 思考模式（thinking: disabled），节省 token 和延迟 */
	thinkingDisabled?: boolean;
}

export interface ChatResult {
	content: string;
	model: string;
	usage: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
		promptCacheHitTokens: number;
		promptCacheMissTokens: number;
	} | null;
}

/**
 * DeepSeek API 客户端
 *
 * 封装 openai npm 包，提供 chat / chatStream 方法。
 * DeepSeek API 与 OpenAI API 完全兼容，只需改 baseURL。
 */
export class DeepSeekClient {
	private client: OpenAI;
	private config: AppConfig;

	constructor(config: AppConfig) {
		this.config = config;
		this.client = new OpenAI({
			apiKey: config.apiKey,
			baseURL: config.baseUrl,
			maxRetries: 3,
			timeout: 120_000, // 2 分钟超时 — Pro extract/compile 可能较长
		});
	}

	/** 非流式聊天补全 */
	async chat(opts: ChatOptions): Promise<ChatResult> {
		const openAiMessages: ChatCompletionMessageParam[] = [
			{ role: "system", content: opts.systemPrompt },
			...opts.messages.map((m) =>
				m.role === "user"
					? ({ role: "user", content: m.content } as const)
					: ({ role: "assistant", content: m.content } as const),
			),
		];

		const response = await this.client.chat.completions.create(
			{
				model: opts.model,
				messages: openAiMessages,
				response_format:
					opts.responseFormat === "json_object"
						? { type: "json_object" }
						: undefined,
				max_tokens: opts.maxTokens,
				stream: false,
			},
			{
				signal: opts.signal,
				// extra_body 传 thinking: disabled 关闭 V4 思考模式
				...(opts.thinkingDisabled
					? { extra_body: { thinking: { type: "disabled" } } }
					: {}),
			},
		);

		const choice = response.choices[0];
		const content = choice?.message?.content ?? "";
		const usage = response.usage;

		return {
			content,
			model: response.model,
			usage: usage
				? {
						promptTokens: usage.prompt_tokens ?? 0,
						completionTokens: usage.completion_tokens ?? 0,
						totalTokens: usage.total_tokens ?? 0,
						promptCacheHitTokens: (usage as any).prompt_cache_hit_tokens ?? 0,
						promptCacheMissTokens: (usage as any).prompt_cache_miss_tokens ?? 0,
					}
				: null,
		};
	}

	/** 流式聊天补全 */
	async chatStream(opts: ChatOptions): Promise<ChatResult> {
		const openAiMessages: ChatCompletionMessageParam[] = [
			{ role: "system", content: opts.systemPrompt },
			...opts.messages.map((m) =>
				m.role === "user"
					? ({ role: "user", content: m.content } as const)
					: ({ role: "assistant", content: m.content } as const),
			),
		];

		const stream = await this.client.chat.completions.create(
			{
				model: opts.model,
				messages: openAiMessages,
				response_format:
					opts.responseFormat === "json_object"
						? { type: "json_object" }
						: undefined,
				max_tokens: opts.maxTokens,
				stream: true,
			},
			{
				signal: opts.signal,
				// extra_body 传 thinking: disabled 关闭 V4 思考模式
				...(opts.thinkingDisabled
					? { extra_body: { thinking: { type: "disabled" } } }
					: {}),
			},
		);

		let fullContent = "";
		let usage: ChatResult["usage"] = null;

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta?.content;
			if (delta) {
				fullContent += delta;
				opts.onStream?.(delta);
			}
			if (chunk.usage) {
				usage = {
					promptTokens: chunk.usage.prompt_tokens ?? 0,
					completionTokens: chunk.usage.completion_tokens ?? 0,
					totalTokens: chunk.usage.total_tokens ?? 0,
					promptCacheHitTokens:
						(chunk.usage as any).prompt_cache_hit_tokens ?? 0,
					promptCacheMissTokens:
						(chunk.usage as any).prompt_cache_miss_tokens ?? 0,
				};
			}
		}

		return {
			content: fullContent,
			model: opts.model,
			usage,
		};
	}
}
