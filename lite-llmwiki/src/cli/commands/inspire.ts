import type { Command } from "commander";
import { loadConfig } from "../../config.js";
import { inspireWiki } from "../../query/inspire.js";

export function registerInspireCommand(program: Command): void {
  program
    .command("inspire")
    .description("Randomly pick a wiki concept page for inspiration")
    .option("-j, --json", "output JSON")
    .option("-k, --kind <kind>", "filter by kind (concept, claim, insight, method, etc.)")
    .option("-t, --tags <tags>", "filter by tags (comma-separated, any match)")
    .action(async (options: { json?: boolean; kind?: string; tags?: string }) => {
      const config = loadConfig();
      const tags = options.tags
        ? options.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
        : undefined;

      const result = inspireWiki(config, {
        kind: options.kind,
        tags,
      });

      if (!result) {
        if (options.json) {
          console.log(JSON.stringify({ found: false }));
        } else {
          console.log("");
          console.log("  ✨  No inspiration found — the wiki is empty or no matching pages.");
          console.log("");
        }
        return;
      }

      if (options.json) {
        console.log(JSON.stringify({ found: true, page: result }, null, 2));
        return;
      }

      // ── Human-readable output ──
      console.log("");
      console.log(`  ✨  ${result.title}`);
      console.log(`  ${renderKind(result.kind)}  ·  ${result.filePath}`);
      if (result.tags.length > 0) {
        console.log(`  tags: ${result.tags.join(", ")}`);
      }
      console.log("");

      if (result.claim) {
        // 截取前 600 字符展示
        const snippet = result.claim.length > 600
          ? result.claim.slice(0, 600) + "\n  …"
          : result.claim;
        console.log(`  ${snippet}`);
        console.log("");
      }

      if (result.evidence.length > 0) {
        console.log("  Evidence:");
        for (const ev of result.evidence.slice(0, 3)) {
          const line = ev.length > 120 ? ev.slice(0, 120) + "…" : ev;
          console.log(`    • ${line}`);
        }
        if (result.evidence.length > 3) {
          console.log(`    … and ${result.evidence.length - 3} more`);
        }
        console.log("");
      }

      if (result.interpretation) {
        const snippet = result.interpretation.length > 300
          ? result.interpretation.slice(0, 300) + "…"
          : result.interpretation;
        console.log(`  Interpretation: ${snippet}`);
        console.log("");
      }

      if (result.useFor.length > 0) {
        console.log("  Use for:");
        for (const u of result.useFor.slice(0, 3)) {
          console.log(`    • ${u}`);
        }
        if (result.useFor.length > 3) {
          console.log(`    … and ${result.useFor.length - 3} more`);
        }
        console.log("");
      }
    });
}

function renderKind(kind: string): string {
  const emojiMap: Record<string, string> = {
    concept: "📘",
    claim: "📌",
    method: "🔧",
    case: "📋",
    equation: "📐",
    question: "❓",
    insight: "💡",
    anchor: "⚓",
    counter: "⚡",
  };
  const emoji = emojiMap[kind] ?? "📄";
  return `${emoji} ${kind}`;
}
