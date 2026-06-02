import type { Command } from "commander";
import { loadConfig } from "../../config.js";
import { auditWiki } from "../../knowledge/audit.js";

export function registerAuditCommand(program: Command): void {
  program
    .command("audit")
    .description("Check wiki evidence traceability back to raw/chase")
    .option("-s, --source <sourceId>", "Filter by source ID (e.g. raw_pdf_e...)")
    .option("-j, --json", "Output JSON")
    .action(async (options: { source?: string; json?: boolean }) => {
      const config = loadConfig();
      const result = auditWiki(config, { source: options.source });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.ok ? 0 : 2);
      }

      // ── Human-readable output ──
      const { summary, issues } = result;
      console.log("");
      console.log(`  🔍  Wiki Audit${options.source ? ` (source: ${options.source})` : ""}`);
      console.log(`  ${result.ok ? "✅ PASS" : "❌ FAIL"}  coverage: ${(summary.coverage * 100).toFixed(0)}%`);
      console.log(`  ─────────────────────────────`);
      console.log(`  nodes:            ${summary.nodes}`);
      console.log(`  verified:         ${summary.verifiedNodes}`);
      console.log(`  missing evidence: ${summary.missingEvidence}`);
      console.log(`  invalid chunkRef: ${summary.invalidChunkRefs}`);
      console.log("");

      if (issues.length > 0) {
        console.log(`  Issues (${issues.length}):`);
        for (const issue of issues) {
          const icon =
            issue.severity === "error" ? "❌" :
            issue.severity === "warning" ? "⚠️" : "ℹ️";
          console.log(`    ${icon} [${issue.severity}] ${issue.filePath}`);
          console.log(`       ${issue.message}`);
        }
        console.log("");
      }

      process.exit(result.ok ? 0 : 2);
    });
}
