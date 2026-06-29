/**
 * index.ts — CLI entry point for `kaze`.
 *
 * Usage:
 *   kaze test                         # detect **\/*.{spec,test}.{ts,js}
 *   kaze test src/features/           # directory
 *   kaze test "**\/*.spec.ts"         # glob
 *   kaze test --workers=50            # parallel workers (or KAZE_WORKERS env)
 *   kaze test --timeout=30000         # per-test timeout ms
 *   kaze test --reporter=dot          # dot | verbose (default: verbose)
 */

import { parseArgs } from "node:util";

import { run } from "./runner.js";
import { report } from "./reporter.js";
import type { ReporterMode } from "./reporter.js";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    workers: { type: "string" },
    timeout: { type: "string" },
    reporter: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
  strict: false,
});

if (values.help) {
  console.log(`
kaze — E2E test runner

Usage:
  kaze test [pattern] [options]

Options:
  --workers=N       Max parallel workers (or KAZE_WORKERS env var)
  --timeout=N       Per-test timeout in ms (default: 30000)
  --reporter=MODE   Output mode: verbose (default) | dot
  -h, --help        Show this help

Examples:
  kaze test
  kaze test src/features/
  kaze test "**/*.spec.ts"
  kaze test --workers=4 --reporter=dot
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Subcommand detection
// ---------------------------------------------------------------------------

// `kaze test [pattern]` or `kaze [pattern]` (test is optional)
let subcommand = positionals[0];
let patternArg: string | undefined;

if (subcommand === "test") {
  patternArg = positionals[1];
} else {
  // treat it as a pattern if no "test" subcommand given
  patternArg = subcommand;
  subcommand = "test";
}

// ---------------------------------------------------------------------------
// Option extraction
// ---------------------------------------------------------------------------

const workers =
  typeof values.workers === "string" ? parseInt(values.workers, 10) : undefined;
const timeout =
  typeof values.timeout === "string" ? parseInt(values.timeout, 10) : undefined;
const reporterMode: ReporterMode =
  values.reporter === "dot" ? "dot" : "verbose";

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

(async () => {
  try {
    const results = await run({
      pattern: patternArg,
      workers: workers && !isNaN(workers) ? workers : undefined,
      timeout: timeout && !isNaN(timeout) ? timeout : undefined,
    });

    const summary = report(results, reporterMode);

    // Exit code: 1 if any failures or timeouts
    if (summary.failed > 0 || summary.timedOut > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("[kaze] Fatal error:", err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
})();
