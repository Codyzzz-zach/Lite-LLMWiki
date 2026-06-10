import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli/index.ts",
  },
  format: "esm",
  target: "node22",
  sourcemap: true,
  clean: true,
  dts: true,
  platform: "node",
  // better-sqlite3 is a native addon — external so tsup doesn't bundle it
  external: ["better-sqlite3"],
});
