import type { Command } from "commander";
import { loadConfig } from "../../config.js";
import { auditWiki, type AuditResult } from "../../knowledge/audit.js";
import { runSemanticAudit } from "../../knowledge/semantic-audit.js";
import { buildFailureJson } from "../../agent/contract.js";
import type {
  AppConfig,
  SemanticAuditResult,
} from "../../types.js";

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
  let semantic: SemanticAuditResult | null = null;
  if (options.semantic) {
    // spec 7.7：API key 缺失 → 整体 ok=false, stage=semantic-audit (spec 11.3 failure shape)
    if (!options.llmJudge) {
      const failure = buildFailureJson({
        stage: "semantic-audit",
        error: "stage=semantic-audit: no LLM judge provided (missing API key or call site). Pass an llmJudge option or set DEEPSEEK_API_KEY.",
        blockingIssues: ["no-llm-judge"],
        suggestedNextActions: [
          "set DEEPSEEK_API_KEY environment variable",
          "pass an llmJudge option to the CLI",
        ],
      });
      // 兼容：result.semantic 仍保留 SyntheticAuditResult 形状（issues 含 reason）
      // JSON 输出含 spec 11.3 failure 字段
      const semantic: SemanticAuditResult = {
        ok: false,
        summary: { nodes: 0, passed: 0, warning: 0, failed: 0, averageScore: 0 },
        issues: [{
          nodeId: "",
          filePath: "",
          severity: "error",
          dimension: "support",
          claim: "",
          evidenceExcerpt: "",
          reason: failure.error,
        }],
      };
      const jsonOutput = { structure, semantic, ...failure };
      out(JSON.stringify(jsonOutput, null, 2));
      return { ok: false, structure, semantic, exitCode: 2 };
    }
    semantic = await runSemanticAudit(config, {
      source: options.source,
      nodeId: options.node,
      llmJudge: options.llmJudge,
    });
  }

  // ── JSON 输出 ──
  const jsonOutput = semantic
    ? { structure, semantic }
    : structure;
  out(JSON.stringify(jsonOutput, null, 2));

  const ok = structure.ok && (semantic?.ok ?? true);
  return { ok, structure, semantic, exitCode: ok ? 0 : 2 };
}

export function registerAuditCommand(program: Command): void {
  program
    .command("audit")
    .description("Check wiki evidence traceability (structure + semantic)")
    .option("-s, --source <sourceId>", "Filter by source ID (e.g. raw_pdf_e...)")
    .option("--node <nodeId>", "Filter to a specific node (semantic only)")
    .option("--semantic", "Run semantic audit (LLM judge) in addition to structure audit")
    .option("-j, --json", "Output JSON")
    .action(async (options: AuditCliOptions) => {
      const config = loadConfig();
      const result = await runAuditCli(config, options);
      process.exit(result.exitCode);
    });
}
