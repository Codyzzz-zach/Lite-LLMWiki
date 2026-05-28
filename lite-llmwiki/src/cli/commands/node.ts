import type { Command } from "commander";
import { loadConfig } from "../../config.js";
import { KnowledgeStore } from "../../knowledge/store.js";

export function registerNodeCommand(program: Command): void {
  program
    .command("node")
    .description("Show a wiki page and its content")
    .argument("<id>", "node ID (e.g. concept/graph-rag)")
    .action(async (id: string) => {
      const config = loadConfig();
      const store = new KnowledgeStore(config);

      // 尝试找到匹配的 wiki 文件
      const allPages = store.listWikiPages();
      const matched = allPages.filter((p) => p.includes(id));

      if (matched.length === 0) {
        console.error(`  ❌  No wiki page found matching: ${id}`);
        process.exit(1);
      }

      const filePath = matched[0]!;
      const content = store.readWikiPage(filePath);

      if (!content) {
        console.error(`  ❌  Cannot read file: ${filePath}`);
        process.exit(1);
      }

      console.log("");
      console.log(`  📄  ${filePath}`);
      console.log(`  ─────────────────────────────`);
      // 显示前 2000 字符
      const preview = content.length > 2000 ? content.slice(0, 2000) + "\n  … (truncated)" : content;
      for (const line of preview.split("\n")) {
        console.log(`  ${line}`);
      }
      console.log("");
    });
}
