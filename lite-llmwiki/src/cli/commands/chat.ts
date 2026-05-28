import type { Command } from "commander";
import React from "react";
import { render } from "ink";
import { App } from "../ui/App.js";

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Start TUI (terminal user interface)")
    .action(() => {
      const { waitUntilExit } = render(React.createElement(App));
      process.on("SIGINT", () => process.exit(0));
    });
}
