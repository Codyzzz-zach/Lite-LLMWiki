/**
 * export / import CLI — OKF 导出导入命令
 */
import type { Command } from "commander";
import { loadConfig } from "../../config.js";
import { exportToOkf } from "../../okf/export.js";
import { importFromOkf } from "../../okf/import.js";

export function registerOkfCommands(program: Command): void {
	program
		.command("export")
		.description("Export wiki to OKF bundle")
		.option("--okf", "Export in OKF format")
		.option("--out <dir>", "Output directory", "./okf-export")
		.action(async (options: { okf?: boolean; out?: string }) => {
			if (!options.okf) {
				console.log("Use --okf to export in Open Knowledge Format.");
				console.log("Example: llmwiki export --okf --out ./my-bundle");
				return;
			}
			const config = loadConfig();
			console.log("Exporting wiki to OKF bundle...");
			const result = exportToOkf(config, options.out ?? "./okf-export");
			console.log(
				`✅ Exported ${result.count} concepts to ${result.bundlePath}`,
			);
		});

	program
		.command("import")
		.description("Import OKF bundle into wiki")
		.option("--okf", "Import from OKF format")
		.argument("<path>", "Path to OKF bundle directory")
		.action(async (bundlePath: string, options: { okf?: boolean }) => {
			if (!options.okf) {
				console.log("Use --okf to import from Open Knowledge Format.");
				console.log("Example: llmwiki import --okf ./my-bundle/okf-bundle");
				return;
			}
			const config = loadConfig();
			console.log(`Importing OKF bundle from ${bundlePath}...`);
			const result = importFromOkf(config, bundlePath);
			console.log(
				`✅ Imported ${result.imported} concepts (${result.skipped} skipped)`,
			);
			console.log("Run 'llmwiki audit' to validate imported nodes.");
		});
}
