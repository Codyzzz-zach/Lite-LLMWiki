#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registerIngestCommand } from "./commands/ingest.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerQueryCommand } from "./commands/query.js";
import { registerNodeCommand } from "./commands/node.js";
import { registerChatCommand } from "./commands/chat.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerAuditCommand } from "./commands/audit.js";
import { registerInspireCommand } from "./commands/inspire.js";
import { registerPlanCommand } from "./commands/plan.js";

// 读取 package.json 版本号
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, "..", "..", "..", "package.json");
let version = "0.1.0";
try {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  version = pkg.version ?? version;
} catch {
  // fallback
}

const program = new Command();

program
  .name("llmwiki")
  .description("DeepSeek-native terminal knowledge workbench")
  .version(version);

registerIngestCommand(program);
registerStatusCommand(program);
registerQueryCommand(program);
registerNodeCommand(program);
registerChatCommand(program);
registerSearchCommand(program);
registerAuditCommand(program);
registerInspireCommand(program);
registerPlanCommand(program);

program.parse(process.argv);
