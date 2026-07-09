import type { Command } from "commander";
import { loadConfig } from "../../config.js";
import { isDaemonAlive, readDaemonState } from "../../daemon/state.js";
import { KnowledgeStore } from "../../knowledge/store.js";

export function registerStatusCommand(program: Command): void {
	program
		.command("status")
		.description("Show knowledge base statistics")
		.option("--json", "Output as JSON")
		.action(async (options: { json?: boolean }) => {
			const config = loadConfig();
			const store = new KnowledgeStore(config);
			const stats = store.getStats();
			const projectRoot = config.projectRoot || process.cwd();
			const daemonState = readDaemonState(projectRoot);
			const daemonRunning = daemonState ? isDaemonAlive(daemonState) : false;

			if (options.json) {
				const json = {
					project: config.projectRoot,
					rawFiles: stats.totalSources,
					wikiPages: stats.totalNodes,
					daemon: daemonRunning
						? {
								running: true,
								pid: daemonState!.pid,
								startedAt: daemonState!.startedAt,
								lastHeartbeat: daemonState!.lastHeartbeat,
								stats: daemonState!.stats,
							}
						: { running: false },
				};
				console.log(JSON.stringify(json, null, 2));
				return;
			}

			console.log("");
			console.log("  📊  Knowledge Base Status");
			console.log("  ─────────────────────────────");
			console.log(`  project:  ${config.projectRoot}`);
			console.log(`  raw/:     ${stats.totalSources} files`);
			console.log(`  wiki/:    ${stats.totalNodes} pages`);
			console.log(
				`  daemon:   ${daemonRunning ? `running (pid ${daemonState!.pid})` : "not running"}`,
			);
			console.log("");

			const pages = store.listWikiPages();
			if (pages.length > 0) {
				console.log("  Wiki pages:");
				for (const p of pages.slice(0, 10)) {
					console.log(`    • ${p}`);
				}
				if (pages.length > 10) {
					console.log(`    … and ${pages.length - 10} more`);
				}
				console.log("");
			}
		});
}
