import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
/**
 * daemon CLI 命令
 *
 * 控制 daemon 进程：
 *   llmwiki daemon              # 前台运行
 *   llmwiki daemon --background # 后台运行
 *   llmwiki daemon --stop       # 停止
 *   llmwiki daemon --status     # 查看状态
 */
import type { Command } from "commander";
import { loadConfig } from "../../config.js";
import { isDaemonAlive, readDaemonState } from "../../daemon/state.js";

export function registerDaemonCommand(program: Command): void {
	program
		.command("daemon")
		.description("Start the wiki maintenance daemon (CI pipeline)")
		.option("--background", "Run daemon in background")
		.option("--stop", "Stop the running daemon")
		.option("--status", "Show daemon status")
		.action(
			async (options: {
				background?: boolean;
				stop?: boolean;
				status?: boolean;
			}) => {
				const config = loadConfig();
				const projectRoot = config.projectRoot || process.cwd();

				if (options.status) {
					const state = readDaemonState(projectRoot);
					if (!state) {
						console.log("Daemon: not running (no state file)");
					} else if (isDaemonAlive(state)) {
						console.log(
							`Daemon: running (pid ${state.pid}, started ${state.startedAt})`,
						);
						console.log(`  Heartbeat: ${state.lastHeartbeat}`);
						console.log(
							`  Stats: ${state.stats.propsExtracted} props extracted, ${state.stats.auditsRun} audits, ${state.stats.lintsRun} lints`,
						);
					} else {
						console.log(
							`Daemon: stale (pid ${state.pid} not responding, last heartbeat ${state.lastHeartbeat})`,
						);
					}
					return;
				}

				if (options.stop) {
					const state = readDaemonState(projectRoot);
					if (!state || !isDaemonAlive(state)) {
						console.log("Daemon: not running");
						return;
					}
					try {
						process.kill(state.pid, "SIGTERM");
						console.log(`Daemon: sent SIGTERM to pid ${state.pid}`);
					} catch {
						console.log(
							`Daemon: failed to stop pid ${state.pid} (already dead?)`,
						);
					}
					return;
				}

				if (options.background) {
					// 后台启动：spawn 子进程并 detach
					// 用 import.meta.url 定位 daemon 入口——不依赖 projectRoot 结构
					const daemonEntry = join(
						dirname(fileURLToPath(import.meta.url)),
						"..",
						"..",
						"daemon",
						"index.ts",
					);
					const child = spawn("npx", ["tsx", daemonEntry], {
						cwd: projectRoot,
						detached: true,
						stdio: "ignore",
						env: {
							PATH: process.env.PATH,
							HOME: process.env.HOME,
							DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "",
							DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL ?? "",
						},
					});
					child.unref();
					console.log(`Daemon: starting in background (pid ${child.pid})`);
					return;
				}

				// 前台运行
				const { runDaemon } = await import("../../daemon/index.js");
				await runDaemon();
			},
		);
}
