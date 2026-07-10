import type { Command } from "commander";
import { } from "../../agent/contract.js";
import { loadConfig } from "../../config.js";
import { writeAuditGate } from "../../knowledge/audit-gate.js";
import {
	type AuditResult,
	auditWiki,
	writeAuditResults,
} from "../../knowledge/audit.js";
import {
	runSemanticAudit,
	writeSemanticAuditResults,
} from "../../knowledge/semantic-audit.js";
import type { AppConfig, SemanticAuditResult } from "../../types.js";
import { tryMakeLlmJudge } from "../cli-llm-init.js";

export interface AuditCliOptions {
	source?: string;
	node?: string;
	semantic?: boolean;
	/** 注入 LLM judge（生产环境由 CLI 包装层注入） */
	llmJudge?: (prompt: string) => Promise<string>;
	/** 注入 stdout（便于测试） */
	stdout?: (line: string) => void;
}

export interface AuditCliResult {
	ok: boolean;
	structure: AuditResult;
	semantic: SemanticAuditResult | null;
	exitCode: number;
}

/**
 * 纯函数版 audit CLI 逻辑（便于测试）。
 *
 * 行为：
 * - 始终跑结构 audit
 * - options.semantic 时跑 semantic audit
 * - 输出 JSON 到 stdout（或测试时给定的 sink）
 * - 返回 exit code（0 = pass, 2 = fail）
 */
export async function runAuditCli(
	config: AppConfig,
	options: AuditCliOptions = {},
): Promise<AuditCliResult> {
	const out = options.stdout ?? ((line: string) => console.log(line));

	const structure = auditWiki(config, { source: options.source });
	// 将结构审计结果写回 wiki frontmatter
	writeAuditResults(config, structure);
	let semantic: SemanticAuditResult | null = null;
	if (options.semantic) {
		try {
			semantic = await runSemanticAudit(config, {
				source: options.source,
				nodeId: options.node,
				llmJudge: options.llmJudge,
			});
			// 将语义审计结果写回 wiki frontmatter（auditStatus + auditScore）
			writeSemanticAuditResults(config, semantic);
		} catch (e) {
			// llmJudge 缺失或 LLM 调用失败 → 结构化失败而非抛错
			semantic = {
				ok: false,
				summary: {
					nodes: 0,
					passed: 0,
					warning: 0,
					failed: 0,
					averageScore: 0,
				},
				issues: [
					{
						nodeId: "",
						filePath: "",
						severity: "error",
						dimension: "support",
						claim: "",
						evidenceExcerpt: "",
						reason: `stage=semantic-audit: ${(e as Error).message}`,
					},
				],
			};
		}
	}

	// ── JSON 输出 ──
	if (semantic) {
		const jsonOutput: Record<string, unknown> = { structure, semantic };
		if (!semantic.ok) {
			jsonOutput.stage = "semantic-audit";
			jsonOutput.blockingIssues = (semantic.issues || []).filter((i: any) => i.severity === "error").map((i: any) => i.reason);
			jsonOutput.suggestedNextActions = ["run `audit --semantic --json` to see details", "re-ingest if claims are stretched"];
		}
		out(JSON.stringify(jsonOutput, null, 2));
	} else {
		out(JSON.stringify(structure, null, 2));
	}

	const ok = structure.ok && (semantic?.ok ?? true);

	// ── 写入审计关卡（spec 11.2 audit gate） ──
	writeAuditGate(
		config,
		structure.ok,
		semantic?.ok ?? null,
		structure.summary.nodes,
		semantic?.summary.averageScore ?? null,
	);

	return { ok, structure, semantic, exitCode: ok ? 0 : 2 };
}

export function registerAuditCommand(program: Command): void {
	program
		.command("audit")
		.description("Check wiki evidence traceability (structure + semantic)")
		.option(
			"-s, --source <sourceId>",
			"Filter by source ID (e.g. raw_pdf_e...)",
		)
		.option("--node <nodeId>", "Filter to a specific node (semantic only)")
		.option(
			"--semantic",
			"Run semantic audit (LLM judge) in addition to structure audit",
		)
		.option("-j, --json", "Output JSON")
		.action(async (options: AuditCliOptions) => {
			const config = loadConfig();
			// CLI 包装层：从 .env / 环境变量构造 llmJudge
			// tryMakeLlmJudge 无 key 时直接抛错（本产品必须有 API key）
			if (options.semantic && !options.llmJudge) {
				options.llmJudge = tryMakeLlmJudge(config);
			}
			const result = await runAuditCli(config, options);
			process.exit(result.exitCode);
		});
}
