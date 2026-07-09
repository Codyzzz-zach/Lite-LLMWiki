/**
 * llm-provider — LLM 调用抽象层
 *
 * 将 LLM 调用与具体模型/API 解耦。compile/audit/query 等模块调 LLMProvider，
 * 不直接依赖 DeepSeekClient。为跨模型审计（第三层防御）提供基础设施。
 *
 * 设计决策（架构设计 §17#4）：
 * - v1 只有 DeepSeekProvider，但接口预留 chatWithThinking 用于 reasoning 模型
 * - 跨模型审计随时能加第二个实现
 */

import type { AppConfig } from "../types.js";
import type { ChatOptions, ChatResult } from "./client.js";
import { DeepSeekClient } from "./client.js";

// ─── 接口 ──────────────────────────────────────────────────────────

/** LLM 调用接口——所有 LLM 交互的统一入口 */
export interface LLMProvider {
	/** 标准聊天补全 */
	chat(opts: ChatOptions): Promise<ChatResult>;

	/**
	 * 带思考链的聊天补全（reasoning 模型）。
	 * 默认回退到 chat()——具体 Provider 可覆盖。
	 */
	chatWithThinking(opts: ChatOptions): Promise<ChatResult>;
}

// ─── 实现 ──────────────────────────────────────────────────────────

/**
 * DeepSeek LLM Provider
 *
 * 封装 DeepSeekClient，实现 LLMProvider 接口。
 * chatWithThinking 只是 chat 的别名——DeepSeek 的 reasoning 通过
 * 模型选择（deepseek-v4-pro vs deepseek-v4-flash）区分，
 * prompt 层面无需特殊处理。
 */
export class DeepSeekProvider implements LLMProvider {
	private client: DeepSeekClient;

	constructor(config: AppConfig) {
		this.client = new DeepSeekClient(config);
	}

	async chat(opts: ChatOptions): Promise<ChatResult> {
		return this.client.chat(opts);
	}

	async chatWithThinking(opts: ChatOptions): Promise<ChatResult> {
		// DeepSeek reasoning 模型通过 model 字段选择，接口一致
		return this.client.chat(opts);
	}
}

/** 工厂函数——从 config 创建默认 LLMProvider */
export function createLLMProvider(config: AppConfig): LLMProvider {
	return new DeepSeekProvider(config);
}
