#!/usr/bin/env node
/**
 * kaze CLI wrapper
 * Loads tsx for TypeScript support before running the CLI.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const dir = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(dir, "../dist/cli/index.js");

// Find tsx in node_modules (peer or own)
const tsxLocations = [
  join(dir, "../node_modules/.bin/tsx"),
  join(dir, "../../.bin/tsx"),
  "tsx",
];
const tsx = tsxLocations.find((p) => p === "tsx" || existsSync(p));

// vitest stub loader — prevents spec files that import vitest from crashing
// when running outside the vitest runner context
const vitestStub = join(dir, "../dist/cli/vitest-stub-loader.js");

if (tsx) {
  // Launch with tsx (TypeScript support) + vitest stub loader
  const importArgs = existsSync(vitestStub)
    ? ["--import", "tsx/esm", "--import", vitestStub]
    : ["--import", "tsx/esm"];

  const r = spawnSync(
    process.execPath,
    [...importArgs, cliEntry, ...process.argv.slice(2)],
    { stdio: "inherit", env: process.env }
  );
  process.exit(r.status ?? 0);
} else {
  // tsx not found — .ts spec files will fail unless already transpiled
  const { main } = await import(cliEntry);
  await main(process.argv.slice(2));
}
