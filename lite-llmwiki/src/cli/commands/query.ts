import type { Command } from "commander";
import { loadConfig } from "../../config.js";
import { tryMakeLlmCaller } from "../cli-llm-init.js";
import { checkAuditGate } from "../../knowledge/audit-gate.js";
import { buildQueryBoard, type BuildQueryBoardOptions } from "../../query/board.js";
import { queryKnowledge } from "../../query/engine.js";
import type { QueryBoard } from "../../types.js";

export interface RunQueryCliOptions {
  mode?: string;
  max?: string;
  includeLegacy?: boolean;
  includeFailed?: boolean;
  json?: boolean;
  /** 注入 board builder（便于测试） */
  buildBoard?: (config: ReturnType<typeof loadConfig>, question: string, options: BuildQueryBoardOptions) => Promise<QueryBoard>;
  /** 注入 LLM caller（生产环境用 queryKnowledge，测试可 mock） */
  llmCaller?: (args: { question: string; board: QueryBoard; config: unknown }) => Promise<{ answer: string; fromWiki: unknown[]; modelSynthesis: unknown[]; missingEvidence: unknown[] }>;
  stdout?: (line: string) => void;
}

export interface RunQueryCliResult {
  ok: boolean;
  board: QueryBoard;
  answer: string;
  exitCode: number;
}

/**
 * 纯函数版 query CLI 逻辑。
 *
 * 行为（plan 9.1 / 10.4）：
 * - buildQueryBoard 装配 QueryBoard（确定性）
 * - queryKnowledge 装配 board + 调 LLM caller + 输出分层
 * - 输出 JSON 含 board / boardSummary / fromWiki / modelSynthesis / missingEvidence / suggestedNextActions
 * - 返回 exit code
 */
export async function runQueryCli(
  config: ReturnType<typeof loadConfig>,
  question: string,
  options: RunQueryCliOptions = {},
): Promise<RunQueryCliResult> {
  const out = options.stdout ?? ((line: string) => console.log(line));
  const maxNodes = parseInt(options.max ?? "5", 10) || 5;

  // ── 1. 装配 board（保留完整 board 用于 result.board）──
  const builder = options.buildBoard ?? buildQueryBoard;
  const board = await builder(config, question, {
    mode: options.mode ?? "ask",
    maxNodes,
    includeLegacy: !!options.includeLegacy,
    includeFailed: !!options.includeFailed,
  });

  // ── 2. 调 queryKnowledge（自动处理 LLM caller / board-only）──
  const result = await queryKnowledge({
    question,
    config,
    mode: options.mode ?? "ask",
    maxNodes,
    includeLegacy: !!options.includeLegacy,
    includeFailed: !!options.includeFailed,
    llmCaller: options.llmCaller
      ? async (_b, q) => {
          // CLI 注入的 llmCaller 签名是 (board, question) → { answer, fromWiki, modelSynthesis, missingEvidence }
          const r = await options.llmCaller!({ question: q, board: _b, config });
          return { answer: r.answer };
        }
      : undefined,
  });

  // ── 3. JSON 输出 ──
  const out_json = {
    ok: result.ok,
    mode: result.mode,
    question: result.question,
    board,
    boardSummary: result.boardSummary,
    answer: result.answer,
    fromWiki: result.fromWiki,
    modelSynthesis: result.modelSynthesis,
    missingEvidence: result.missingEvidence,
    suggestedNextActions: result.suggestedNextActions,
  };
  out(JSON.stringify(out_json, null, 2));

  return { ok: true, board, answer: result.answer, exitCode: 0 };
}

export function registerQueryCommand(program: Command): void {
  program
    .command("query")
    .description("Query the knowledge base with a natural language question (v6 board)")
    .argument("<question>", "your question")
    .option("-j, --json", "output JSON")
    .option("-n, --max <number>", "max seed nodes", "5")
    .option("--mode <mode>", "board mode: ask|trace|expand|compare|challenge|inspire (alias: exact→trace, explore→expand, counter→challenge)", "ask")
    .option("--node <nodeId>", "force a specific node as seed")
    .option("--source <sourceId>", "filter by source")
    .option("--tags <tags>", "filter by tags (comma-separated)")
    .option("--with-source", "include chase excerpts (default: only for trace)")
    .option("--include-legacy", "include legacy pages without evidence", false)
    .option("--include-failed", "include auditStatus=failed nodes", false)
    .action(
      async (question: string, options: RunQueryCliOptions) => {
        const config = loadConfig();
        // spec 11.2: 检查审计关卡
        const gate = checkAuditGate(config);
        if (!gate.passed) {
          if (options.json || true) { // query 默认 JSON 输出
            console.log(JSON.stringify(gate.failure, null, 2));
          }
          process.exit(2);
        }
        if (gate.warning) {
          console.warn(`  ⚠️  ${gate.warning}`);
        }
        // CLI 包装层：从 .env / 环境变量构造 llmCaller
        if (!options.llmCaller) {
          const caller = tryMakeLlmCaller(config);
          if (caller) {
            // 适配签名：CLI 的 llmCaller 签名与 engine 的不同
            options.llmCaller = async ({ question: q, board: b, config: _c }) => {
              const r = await caller(b, q);
              return { answer: r.answer, fromWiki: [], modelSynthesis: [], missingEvidence: [] };
            };
          }
        }
        const result = await runQueryCli(config, question, options);
        process.exit(result.exitCode);
      },
    );
}