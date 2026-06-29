import { defineConfig } from "tsup";

export default defineConfig([
  // Library + CLI: all entries in one pass with clean
  {
    entry: ["src/index.ts", "src/installer/index.ts", "src/cli/index.ts", "src/cli/vitest-stub-loader.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2022",
  },
]);
