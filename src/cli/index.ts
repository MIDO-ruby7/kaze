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
import { loadConfig, mergeConfig } from "./config.js";
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
    grep: { type: "string" },
    "grep-invert": { type: "string" },
    retries: { type: "string" },
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
  --workers=N              Max parallel workers (or KAZE_WORKERS env var)
  --timeout=N              Per-test timeout in ms (default: 30000)
  --reporter=MODE          Output mode: verbose (default) | dot
  --screenshot=off         Disable auto-screenshot on failure/timeout
  --grep=PATTERN           Only run tests matching regex pattern
  --grep-invert=PATTERN    Skip tests matching regex pattern
  --retries=N              Retry failing tests N times (default: 0)
  --watch, -w              Watch for file changes and re-run tests
  -h, --help               Show this help

Examples:
  kaze
  kaze src/features/
  kaze "**/*.spec.ts"
  kaze --workers=4 --reporter=dot
  kaze --grep="login"
  kaze --grep-invert="slow"
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
// Run
// ---------------------------------------------------------------------------

(async () => {
  try {
    // AC-1/AC-2: Load project-level config file
    const fileConfig = await loadConfig(process.cwd());

    // AC-3: Build CLI override object — only defined CLI flags override config
    const cliWorkers =
      typeof values.workers === "string" ? parseInt(values.workers, 10) : undefined;
    const cliTimeout =
      typeof values.timeout === "string" ? parseInt(values.timeout, 10) : undefined;
    const cliReporter =
      values.reporter === "dot" || values.reporter === "verbose"
        ? values.reporter
        : undefined;
    // --screenshot=off → false; --screenshot=on → true; absent/other → undefined (defer to config)
    const cliScreenshot =
      values.screenshot === "off" ? false :
      values.screenshot === "on"  ? true  : undefined;
    const cliGrep = typeof values.grep === "string" ? values.grep : undefined;
    const cliGrepInvert =
      typeof values["grep-invert"] === "string" ? values["grep-invert"] : undefined;
    const cliRetries =
      typeof values.retries === "string" ? parseInt(values.retries, 10) : undefined;

    const config = mergeConfig(fileConfig, {
      workers: cliWorkers !== undefined && !isNaN(cliWorkers) ? cliWorkers : undefined,
      timeout: cliTimeout !== undefined && !isNaN(cliTimeout) ? cliTimeout : undefined,
      reporter: cliReporter,
      screenshot: cliScreenshot,
      grep: cliGrep,
      grepInvert: cliGrepInvert,
      retries: cliRetries !== undefined && !isNaN(cliRetries) ? cliRetries : undefined,
      // testMatch: patterns are handled separately below
    });

    const watchMode = values.watch === true;
    const reporterMode: ReporterMode = config.reporter === "dot" ? "dot" : "verbose";

    // testMatch from config is used only when no positional patterns are given (AC-2)
    const effectivePatterns =
      patterns.length > 0 ? patterns : config.testMatch;

    // screenshot defaults to true if not set by config or CLI
    const screenshotEnabled = config.screenshot !== false;

    if (watchMode) {
      await watch({
        patterns: effectivePatterns ?? [],
        workers: config.workers,
        timeout: config.timeout,
        reporterMode,
        screenshot: screenshotEnabled,
        grep: config.grep,
        grepInvert: config.grepInvert,
        retries: config.retries,
      });
      return;
    }

    const results = await run({
      patterns: effectivePatterns && effectivePatterns.length > 0
        ? effectivePatterns
        : undefined,
      workers: config.workers,
      timeout: config.timeout,
      screenshot: screenshotEnabled,
      grep: config.grep,
      grepInvert: config.grepInvert,
      retries: config.retries,
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
