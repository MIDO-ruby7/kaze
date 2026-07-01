import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "examples/demo.spec.js", // kaze CLI demo, not a vitest test
      "compat/**",              // compat runner specs use kaze API, not vitest
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
    },
  },
});
