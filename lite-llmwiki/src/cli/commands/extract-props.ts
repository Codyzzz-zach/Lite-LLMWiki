import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/**
 * extract-props CLI 命令 —— 命题提取（过渡方案）
 *
 * 在 daemon 建成前，通过 CLI 手动触发命题提取。
 * daemon 建好后，此命令保留作为手动触发选项，daemon 自动调用相同逻辑。
 */
import type { Command } from "commander";
import { loadConfig } from "../../config.js";
import { DeepSeekClient } from "../../core/client.js";
import { extractPropositions } from "../../ingest/proposition.js";

export function registerExtractPropsCommand(program: Command): void {
	program
		.command("extract-props")
		.description(
			"Extract atomic propositions from a chase file (inserts <!-- prop N --> markers)",
		)
		.argument(
			"<chase-file>",
			"Path to the chase file (e.g., raw/chase/my-paper.md)",
		)
		.option("--dry-run", "Preview propositions without modifying the file")
		.action(async (chasePath: string, options: { dryRun?: boolean }) => {
			const config = loadConfig();
			const client = new DeepSeekClient(config);

			// Resolve chase file path
			const fullPath = chasePath.startsWith("/")
				? chasePath
				: join(config.projectRoot, chasePath);

			let content: string;
			try {
				content = readFileSync(fullPath, "utf-8");
			} catch {
				console.error(`❌ Chase file not found: ${fullPath}`);
				process.exit(1);
			}

			console.log(`🔍 Extracting propositions from: ${chasePath}`);
			console.log(`   Content length: ${content.length} chars`);
			console.log("");

			try {
				const llmCaller = async (prompt: string) => {
					const result = await client.chat({
						model: "deepseek-chat",
						systemPrompt: "",
						messages: [{ role: "user", content: prompt }],
						responseFormat: "json_object",
						maxTokens: 16000,
					});
					return result.content;
				};

				const result = await extractPropositions(content, llmCaller);

				console.log(`✅ Extracted ${result.props.length} propositions:`);
				for (const prop of result.props.slice(0, 10)) {
					console.log(
						`   [prop ${prop.index}] ${prop.text.slice(0, 80)}${prop.text.length > 80 ? "…" : ""}`,
					);
				}
				if (result.props.length > 10) {
					console.log(`   … and ${result.props.length - 10} more`);
				}

				if (options.dryRun) {
					console.log("");
					console.log("🔒 Dry run — chase file NOT modified.");
					console.log("   Run without --dry-run to write prop markers.");
				} else {
					writeFileSync(fullPath, result.updatedContent, "utf-8");
					console.log("");
					console.log(`✅ Updated chase file: ${chasePath}`);
					console.log(`   Prop markers inserted. Ready for compile.`);
				}
			} catch (err) {
				console.error(
					`❌ Proposition extraction failed: ${err instanceof Error ? err.message : String(err)}`,
				);
				process.exit(2);
			}
		});
}
