#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerAuditCommand } from "./commands/audit.js";
import { registerChatCommand } from "./commands/chat.js";
import { registerCompileFromPropsCommand } from "./commands/compile-from-props.js";
import { registerConfirmCommand } from "./commands/confirm.js";
import { registerDaemonCommand } from "./commands/daemon.js";
import { registerExtractPropsCommand } from "./commands/extract-props.js";
import { registerIngestPipelineCommand } from "./commands/ingest-pipeline.js";
import { registerIngestCommand } from "./commands/ingest.js";
import { registerInspireCommand } from "./commands/inspire.js";
import { registerNodeCommand } from "./commands/node.js";
import { registerOkfCommands } from "./commands/okf.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerQueryCommand } from "./commands/query.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerStatusCommand } from "./commands/status.js";

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
registerExtractPropsCommand(program);
registerDaemonCommand(program);
registerOkfCommands(program);
registerCompileFromPropsCommand(program);
registerIngestPipelineCommand(program);
registerConfirmCommand(program);

program.parse(process.argv);
