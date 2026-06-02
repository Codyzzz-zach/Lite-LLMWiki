import type { Command } from "commander";
import { loadConfig } from "../../config.js";
import { queryKnowledge } from "../../query/engine.js";

export function registerQueryCommand(program: Command): void {
  program
    .command("query")
    .description("Query the knowledge base with a natural language question")
    .argument("<question>", "your question")
    .option("-j, --json", "output JSON")
    .option("-n, --max <number>", "max source nodes to retrieve", "5")
    .option("--include-legacy", "include legacy pages without evidence", false)
    .action(
      async (
        question: string,
        options: { json?: boolean; max?: string; includeLegacy?: boolean },
      ) => {
        const config = loadConfig();
        const maxNodes = parseInt(options.max ?? "5", 10) || 5;

        if (!config.apiKey) {
          console.error("  ❌  DEEPSEEK_API_KEY not set");
          process.exit(1);
        }

        try {
          const result = await queryKnowledge({
            question,
            config,
            maxNodes,
            includeLegacy: !!options.includeLegacy,
          });

          if (options.json) {
            console.log(
              JSON.stringify(
                {
                  answer: result.answer,
                  sources: result.sources,
                  inferences: result.inferences,
                  missingEvidence: result.missingEvidence,
                  usage: result.usage,
                },
                null,
                2,
              ),
            );
            return;
          }

          // Human-readable output
          console.log("");
          console.log(`  🔍  query: "${question}"`);
          console.log("");

          console.log(`  ${result.answer}`);
          console.log("");

          if (result.sources.length > 0) {
            console.log(`  Sources (${result.sources.length}):`);
            for (const s of result.sources) {
              console.log(`    • [${s.kind}] ${s.title}`);
              console.log(`      node: ${s.nodeId}`);
              console.log(`      file: ${s.filePath}`);
              if (s.evidence.length > 0) {
                const first = s.evidence[0]!;
                const snippet =
                  first.length > 80 ? first.slice(0, 80) + "…" : first;
                console.log(`      evidence: ${snippet}`);
              }
            }
            console.log("");
          }

          if (result.inferences.length > 0) {
            console.log(`  Inferences (${result.inferences.length}):`);
            for (const inf of result.inferences) {
              console.log(`    • ${inf}`);
            }
            console.log("");
          }

          if (result.missingEvidence.length > 0) {
            console.log(`  Missing evidence (${result.missingEvidence.length}):`);
            for (const m of result.missingEvidence) {
              console.log(`    • ${m}`);
            }
            console.log("");
          }

          if (result.usage) {
            console.log(
              `  Tokens: ${result.usage.promptTokens} in / ${result.usage.completionTokens} out`,
            );
          }
        } catch (err) {
          console.error(`  ❌  Query failed: ${(err as Error).message}`);
          process.exit(1);
        }
      },
    );
}
