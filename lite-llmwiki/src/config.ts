import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppConfig } from "./types.js";

export const DEFAULT_MODEL = "deepseek-v4-flash";
// 设计目标 4000 tokens/chunk（§5.5），当前 2000 用于 MVP 单轮模式。
// 引入多轮 listening 后调整到 4000。
export const DEFAULT_CHUNK_TOKEN_TARGET = 2000;
export const DEFAULT_CHUNK_OVERLAP_TOKENS = 200;

/** 查找项目根目录：从 cwd 向上找，直到找到 raw/wiki 中的至少一个 */
export function findProjectRoot(start?: string): string {
	const dir = start ?? process.cwd();
	// 优先：当前目录有 raw/ wiki/ 之一
	const candidates = [dir];
	// 也尝试父目录（当用户在 raw/ 或 src/ 下运行命令时）
	let parent = dir;
	for (let i = 0; i < 5; i++) {
		const next = resolve(parent, "..");
		if (next === parent) break;
		candidates.push(next);
		parent = next;
	}
	for (const c of candidates) {
		if (existsSync(join(c, "raw")) || existsSync(join(c, "wiki"))) {
			return c;
		}
	}
	// 都不存在，用 cwd
	return dir;
}

/** 确保目录存在 */
export function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

/** 从环境变量或 .env 文件加载 API key */
export function loadApiKey(): string {
	// 环境变量优先
	const envKey = process.env.DEEPSEEK_API_KEY;
	if (envKey && envKey.length > 0 && envKey !== "sk-your-key-here") {
		return envKey;
	}
	// 尝试 .env 文件
	const envPath = join(process.cwd(), ".env");
	if (existsSync(envPath)) {
		const content = readFileSync(envPath, "utf-8");
		const match = content.match(/^DEEPSEEK_API_KEY=(.+)$/m);
		if (match && match[1] && match[1].trim() !== "sk-your-key-here") {
			return match[1]!.trim();
		}
	}
	return "";
}

export function loadBaseUrl(): string {
	return process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
}

/** 构建 AppConfig */
export function loadConfig(overrides?: Partial<AppConfig>): AppConfig {
	const projectRoot = overrides?.projectRoot ?? findProjectRoot();
	const rawDir = resolve(projectRoot, "raw");
	const wikiDir = resolve(projectRoot, "wiki");

	// 确保目录存在
	ensureDir(rawDir);
	ensureDir(wikiDir);

	return {
		apiKey: overrides?.apiKey ?? loadApiKey(),
		baseUrl: overrides?.baseUrl ?? loadBaseUrl(),
		projectRoot,
		rawDir,
		wikiDir,
		model: overrides?.model ?? DEFAULT_MODEL,
		chunkTokenTarget: overrides?.chunkTokenTarget ?? DEFAULT_CHUNK_TOKEN_TARGET,
		chunkOverlapTokens:
			overrides?.chunkOverlapTokens ?? DEFAULT_CHUNK_OVERLAP_TOKENS,
	};
}
