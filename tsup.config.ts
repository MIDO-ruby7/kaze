import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/installer/index.ts", "src/cli/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  banner: {
    js: "#!/usr/bin/env node",
  },
});
