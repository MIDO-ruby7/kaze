/**
 * index.ts — CLI entry point for `kaze`.
 *
 * Usage:
 *   kaze                              # detect **\/*.{spec,test}.{ts,js}
 *   kaze src/features/                # directory
 *   kaze "**\/*.spec.ts"              # glob
 *   kaze --workers=50                 # parallel workers (or KAZE_WORKERS env)
 *   kaze --timeout=30000              # per-test timeout ms
 *   kaze --reporter=dot               # dot | verbose (default: verbose)
 *   kaze --watch                      # watch mode
 *   kaze test                         # backward compat: "test" subcommand is stripped
 *   kaze test src/features/           # backward compat
 */

import { parseArgs } from "node:util";

import { run } from "./runner.js";
import { report } from "./reporter.js";
import { watch } from "./watcher.js";
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
    watch: { type: "boolean", short: "w", default: false },
    screenshot: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
  strict: false,
});

if (values.help) {
  console.log(`
kaze — E2E test runner

Usage:
  kaze [pattern...] [options]
  kaze test [pattern...] [options]   # "test" subcommand (backward compat)

Options:
  --workers=N         Max parallel workers (or KAZE_WORKERS env var)
  --timeout=N         Per-test timeout in ms (default: 30000)
  --reporter=MODE     Output mode: verbose (default) | dot
  --screenshot=off    Disable auto-screenshot on failure/timeout
  --watch, -w         Watch for file changes and re-run tests
  -h, --help          Show this help

Examples:
  kaze
  kaze src/features/
  kaze "**/*.spec.ts"
  kaze --workers=4 --reporter=dot
  kaze --watch
  kaze test                          # backward compat
  kaze test src/features/            # backward compat
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Positional processing: strip leading "test" for backward compat
// ---------------------------------------------------------------------------

let args = positionals.slice();
if (args[0] === "test") {
  args = args.slice(1); // remove "test" subcommand — backward compat
}

// Remaining positionals are glob patterns / directories / file paths
const patterns = args; // may be empty → detect all spec files

// ---------------------------------------------------------------------------
// Option extraction
// ---------------------------------------------------------------------------

const workers =
  typeof values.workers === "string" ? parseInt(values.workers, 10) : undefined;
const timeout =
  typeof values.timeout === "string" ? parseInt(values.timeout, 10) : undefined;
const reporterMode: ReporterMode =
  values.reporter === "dot" ? "dot" : "verbose";
const watchMode = values.watch === true;
// AC-4: --screenshot=off disables screenshot capture
const screenshotEnabled = values.screenshot !== "off";

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

(async () => {
  try {
    const runWorkers = workers && !isNaN(workers) ? workers : undefined;
    const runTimeout = timeout && !isNaN(timeout) ? timeout : undefined;

    if (watchMode) {
      await watch({
        patterns,
        workers: runWorkers,
        timeout: runTimeout,
        reporterMode,
      });
      return;
    }

    const results = await run({
      patterns: patterns.length > 0 ? patterns : undefined,
      workers: runWorkers,
      timeout: runTimeout,
      screenshot: screenshotEnabled,
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
