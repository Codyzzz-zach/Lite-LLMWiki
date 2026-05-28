import type { Command } from "commander";
import { loadConfig } from "../../config.js";
import { KnowledgeStore } from "../../knowledge/store.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show knowledge base statistics")
    .action(async () => {
      const config = loadConfig();
      const store = new KnowledgeStore(config);
      const stats = store.getStats();

      console.log("");
      console.log("  📊  Knowledge Base Status");
      console.log(`  ─────────────────────────────`);
      console.log(`  project:  ${config.projectRoot}`);
      console.log(`  raw/:     ${stats.totalSources} files`);
      console.log(`  wiki/:    ${stats.totalNodes} pages`);
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
