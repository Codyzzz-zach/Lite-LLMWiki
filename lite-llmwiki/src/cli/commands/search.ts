import type { Command } from "commander";
import { loadConfig } from "../../config.js";
import { searchWiki } from "../../query/search.js";

export function registerSearchCommand(program: Command): void {
  program
    .command("search")
    .description("Search the knowledge base locally (no LLM call)")
    .argument("<query>", "search keywords")
    .option("-j, --json", "output JSON")
    .option("-n, --max <number>", "max results", "20")
    .option("--include-failed", "include auditStatus=failed nodes", false)
    .action(async (query: string, options: { json?: boolean; max?: string; includeFailed?: boolean }) => {
      const config = loadConfig();
      const maxResults = parseInt(options.max ?? "20", 10) || 20;

      const results = searchWiki(config, query, { maxResults, includeFailed: !!options.includeFailed });

      if (options.json) {
        console.log(JSON.stringify({ matches: results }, null, 2));
        return;
      }

      // Human-readable output
      console.log("");
      console.log(`  🔍  search: "${query}"`);
      console.log(`  ${results.length === 0 ? "No matches found." : `Found ${results.length} matches:`}`);
      console.log("");

      for (const m of results) {
        console.log(`  [${m.kind}] ${m.title}`);
        console.log(`        node: ${m.nodeId}`);
        console.log(`        score: ${m.score.toFixed(2)}`);
        console.log(`        file: ${m.filePath}`);
        if (m.claim) {
          const snippet = m.claim.length > 80 ? m.claim.slice(0, 80) + "…" : m.claim;
          console.log(`        claim: ${snippet}`);
        }
        if (m.evidence.length > 0) {
          const first = m.evidence[0]!;
          const snippet = first.length > 80 ? first.slice(0, 80) + "…" : first;
          console.log(`        evidence: ${snippet}`);
        }
        console.log("");
      }
    });
}
