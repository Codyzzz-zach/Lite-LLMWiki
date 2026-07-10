/**
 * daemon — CI 管道主入口
 *
 * 常驻进程，负责文件监听 + 定时维护。
 * daemon 是 CI pipeline——负责执行和报告，不替 agent 做决策。
 *
 * 七项职责（架构设计 §09）：
 * ① 命题提取：监听到新 chase 文件 → 调 LLM → 插入 prop marker
 * ② 文件监听自动导入：chase 有 prop marker → 触发 compile
 * ③ wiki 变化自动审查：wiki 文件变化 → 触发 audit
 * ④ 定期 lint + 分级修复：定时器 → lint → 机械自动修 / 语义写工单
 * ⑤ 启发发现：人类命令触发（不在此自动执行）
 * ⑥ 回流候选标记：定时器 → 筛选 → 写入 progress.md
 * ⑦ 强化检测：compile 后 → 标记候选
 */

import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import {
	runSemanticAudit,
	writeSemanticAuditResults,
} from "../knowledge/semantic-audit.js";
import { loadConfig } from "../config.js";
import { createLLMProvider } from "../core/llm-provider.js";
import { runIngestPipeline } from "../ingest/pipeline.js";
import { lintWiki } from "./lint.js";
import { screenAndWriteReflow } from "./reflow.js";
import {
	createDaemonState,
	writeDaemonState,
} from "./state.js";
import { type TimerHandles, startTimers, stopTimers } from "./timer.js";
import { startWatcher, stopWatcher } from "./watcher.js";

export async function runDaemon(): Promise<void> {
	const config = loadConfig();
	const projectRoot = config.projectRoot || process.cwd();
	const state = createDaemonState();
	const LOG_FILE = join(projectRoot, "loopadvance", "daemon.log");

	const log = (level: string, msg: string) => {
		const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
		process.stdout.write(line + "\n");
		try {
			appendFileSync(LOG_FILE, line + "\n", "utf-8");
		} catch {
			/* ignore */
		}
	};

	// 确保 loopadvance 目录存在
	const laDir = join(projectRoot, "loopadvance");
	mkdirSync(laDir, { recursive: true });

	log("info", `[daemon] starting (pid ${state.pid})...`);
	writeDaemonState(projectRoot, state);

	const llm = createLLMProvider(config);

	// ── Audit 串行化（Finding 2 修复）──
	// onWikiChange 可能被快速连续触发（一次 ingest 写多个 wiki 节点）。
	// 串行链 + dirty 标志：audit 串行执行，多次变更合并成一次 audit，
	// 避免并发 read-modify-write 写坏 frontmatter。
	let auditChain: Promise<void> = Promise.resolve();
	let auditDirty = false;
	const llmJudge = async (prompt: string) => {
		const result = await (llm as any).chat({
			model: config.model,
			systemPrompt: "",
			messages: [{ role: "user", content: prompt }],
			responseFormat: "json_object",
			thinkingDisabled: true,
			maxTokens: 4096,
		});
		return result.content;
	};
	const runOneAudit = async (wikiPath: string): Promise<void> => {
		const semResult = await runSemanticAudit(config, { llmJudge });
		writeSemanticAuditResults(config, semResult);
		state.queue.pendingAudit = state.queue.pendingAudit.filter(
			(p) => p !== wikiPath,
		);
		log("info", `[daemon] ③ audit complete — ${semResult.summary.passed}P/${semResult.summary.warning}W/${semResult.summary.failed}F`);
		writeDaemonState(projectRoot, state);
	};
	const scheduleAudit = (wikiPath: string): void => {
		auditDirty = true;
		// 串行链：若上一个 audit 在跑，等它跑完再跑这个；dirty 标志让连续变更合并
		auditChain = auditChain
			.then(async () => {
				if (!auditDirty) return;
				auditDirty = false;
				await runOneAudit(wikiPath).catch((err) => {
					log("error", `[daemon] ③ audit failed: ${(err as Error).message}`);
				});
			})
			.catch(() => { /* 链不断 */ });
	};

	// ── Watcher ──
	const watcher = startWatcher(config, {
		onNewChase: (chasePath: string) => {
			log("info", `[daemon] ① new chase detected: ${chasePath}`);
			state.queue.pendingPropExtraction.push(chasePath);
			writeDaemonState(projectRoot, state);
			runIngestPipeline(
				config,
				chasePath.replace(config.rawDir + "/chase/", "raw/chase/"),
				llm as any,
			)
				.then((r) => {
					state.stats.propsExtracted = r.propsExtracted;
					log(
						"info",
						`[daemon] ①② ingest complete: ${r.nodesCompiled} nodes, ${r.edgesWritten} edges, audit=${r.audit?.score}`,
					);
					writeDaemonState(projectRoot, state);
				})
				.catch((err) => {
					log(
						"error",
						`[daemon] ingest pipeline failed: ${(err as Error).message}`,
					);
				});
		},
		onWikiChange: (wikiPath: string) => {
			log("info", `[daemon] ③ wiki changed: ${wikiPath}`);
			state.queue.pendingAudit.push(wikiPath);
			writeDaemonState(projectRoot, state);
			// 串行调度（Finding 2：避免并发 audit 写坏 frontmatter）
			scheduleAudit(wikiPath);
		},
	});

	// ── Timers ──
	let timers: TimerHandles | null = null;
	timers = startTimers({
		onHeartbeat: () => {
			writeDaemonState(projectRoot, state);
		},
		onLint: () => {
			log("info", "[daemon] ④ running lint...");
			try {
				const report = lintWiki(config);
				state.stats.lintsRun++;
				log(
					"info",
					`[daemon] lint complete: ${report.summary.issues} issues (${report.summary.warnings} warnings, ${report.summary.errors} errors)`,
				);
			} catch (err) {
				log("error", `[daemon] lint error: ${(err as Error).message}`);
			}
			writeDaemonState(projectRoot, state);
		},
		onReflowScreen: () => {
			log("info", "[daemon] ⑥ screening reflow candidates...");
			try {
				const count = screenAndWriteReflow(config);
				state.stats.reflowsScreened++;
				if (count > 0) log("info", `[daemon] found ${count} reflow candidates`);
			} catch (err) {
				log("error", `[daemon] reflow error: ${(err as Error).message}`);
			}
			writeDaemonState(projectRoot, state);
		},
	});

	// ── 优雅退出 ──
	const cleanup = () => {
		log("info", "[daemon] stopping...");
		if (timers) stopTimers(timers);
		stopWatcher(watcher).then(() => {
			log("info", "[daemon] stopped");
			process.exit(0);
		});
	};
	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);

	log("info", "[daemon] running — Ctrl+C to stop");
}
