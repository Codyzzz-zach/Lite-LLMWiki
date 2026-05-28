import type { Command } from "commander";
import { loadConfig } from "../../config.js";
import { queryKnowledge } from "../../query/engine.js";

export function registerQueryCommand(program: Command): void {
  program
    .command("query")
    .description("Query the knowledge base with a natural language question")
    .argument("<question>", "your question")
    .action(async (question: string) => {
      const config = loadConfig();

      console.log("");
      console.log(`  🔍  query: "${question}"`);

      if (!config.apiKey) {
        console.error("  ❌  DEEPSEEK_API_KEY not set");
        process.exit(1);
      }

      console.log("  Searching wiki...");
      console.log("");

      try {
        const result = await queryKnowledge({ question, config });

        console.log(`  ${result.answer}`);
        console.log("");

        if (result.sourcePages.length > 0) {
          console.log(`  Sources (${result.sourcePages.length}):`);
          for (const p of result.sourcePages) {
            console.log(`    • ${p.filePath} — ${p.title}`);
          }
          console.log("");
        }

        if (result.usage) {
          console.log(`  Tokens: ${result.usage.promptTokens} in / ${result.usage.completionTokens} out`);
        }
      } catch (err) {
        console.error(`  ❌  Query failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
