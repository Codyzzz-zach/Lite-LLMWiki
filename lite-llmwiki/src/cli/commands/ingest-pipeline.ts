/**
 * ingest CLI —— 一步完成 extract-props + compile + audit + reinforce
 *
 * 用法：llmwiki ingest raw/original/pdf/paper.pdf
 *       llmwiki ingest raw/chase/my-chase.md  （已有 chase 文件）
 */

import type { Command } from "commander";
import { loadConfig } from "../../config.js";
import { DeepSeekClient } from "../../core/client.js";
import { runIngestPipeline } from "../../ingest/pipeline.js";

export function registerIngestPipelineCommand(program: Command): void {
	program
		.command("ingest2") // temporary name to avoid conflict with legacy ingest
		.description(
			"Full ingest pipeline: extract-props → compile → audit → reinforce",
		)
		.argument("<file>", "PDF/MD file or chase file")
		.option("--json", "Output JSON result")
		.option("--no-audit", "Skip audit step")
		.action(
			async (
				inputPath: string,
				options: { json?: boolean; noAudit?: boolean },
			) => {
				const config = loadConfig();
				const client = new DeepSeekClient(config);

				// Determine if input is a chase file (starts with raw/chase/) or needs loader
				const chaseFile =
					inputPath.startsWith("raw/chase/") || inputPath.startsWith("/")
						? inputPath
						: `raw/chase/${inputPath.replace(/^raw\/original\/(pdf|md|tex)\//, "").replace(/\.(pdf|md|tex)$/, "")}.md`;

				console.error(`📥 Ingest: ${inputPath}`);
				console.error(`   → chase: ${chaseFile}`);

				const result = await runIngestPipeline(config, chaseFile, client);

				if (options.json) {
					console.log(JSON.stringify(result, null, 2));
				} else {
					console.log(`\n📊 Ingest complete:`);
					console.log(`   Props: ${result.propsExtracted}`);
					console.log(`   Nodes: ${result.nodesCompiled}`);
					console.log(`   Edges: ${result.edgesWritten}`);
					if (result.audit) {
						console.log(
							`   Audit: struct=${result.audit.structure}, semantic=${result.audit.semantic}, score=${result.audit.score}`,
						);
					}
					console.log(`   Contradictions: ${result.contradictionsFound}`);
					console.log(`   Reinforcements: ${result.reinforcementsFound}`);
				}
			},
		);
}
