/**
 * watcher.ts — watch mode for kaze.
 *
 * Watches spec files and src/ TS/JS files for changes, re-running the
 * relevant tests automatically with a 200ms debounce.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { BrowserPool } from "../pool/BrowserPool.js";
import { detectFiles } from "./runner.js";
import { run } from "./runner.js";
import { report } from "./reporter.js";
import type { RunOptions } from "./runner.js";
import type { ReporterMode } from "./reporter.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface WatchOptions extends RunOptions {
  patterns: string[];
  reporterMode?: ReporterMode;
  screenshot?: boolean;
}

export async function watch(opts: WatchOptions): Promise<void> {
  const cwd = process.cwd();
  const reporterMode = opts.reporterMode ?? "verbose";

  // Resolve all spec files at startup
  function resolveSpecFiles(): string[] {
    const seen = new Set<string>();
    const all: string[] = [];
    if (opts.patterns.length > 0) {
      for (const p of opts.patterns) {
        for (const f of detectFiles(p, cwd)) {
          if (!seen.has(f)) {
            seen.add(f);
            all.push(f);
          }
        }
      }
    } else {
      for (const f of detectFiles(undefined, cwd)) {
        if (!seen.has(f)) {
          seen.add(f);
          all.push(f);
        }
      }
    }
    return all.sort();
  }

  // ---------------------------------------------------------------------------
  // Init pool once and reuse across runs
  // ---------------------------------------------------------------------------

  const envWorkers = parseInt(process.env.KAZE_WORKERS ?? "0", 10) || undefined;
  const workers = opts.workers ?? envWorkers;

  const pool = new BrowserPool();
  await pool.init({ workers });

  const stats = pool.stats();
  const parallel = stats.totalContexts;
  const procs = stats.processes;
  const ctxPerProc = procs > 0 ? Math.round(parallel / procs) : parallel;
  console.log(
    `\nkaze watching (${procs} processes × ${ctxPerProc} contexts = ${parallel} parallel)`,
  );

  // ---------------------------------------------------------------------------
  // Initial run
  // ---------------------------------------------------------------------------

  let specFiles = resolveSpecFiles();
  console.log(`Found ${specFiles.length} spec files\n`);

  async function runAll(files?: string[]): Promise<void> {
    const patterns = files ?? specFiles;
    const runOpts: RunOptions = {
      patterns,
      workers: opts.workers,
      timeout: opts.timeout,
      screenshot: opts.screenshot,
      grep: opts.grep,
      grepInvert: opts.grepInvert,
    };
    try {
      const results = await run(runOpts, pool);
      report(results, reporterMode);
    } catch (err) {
      console.error(
        "[kaze] Run error:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  await runAll();
  printWatchingBanner(specFiles);

  // ---------------------------------------------------------------------------
  // Debounce state
  // ---------------------------------------------------------------------------

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingFiles = new Set<string>();

  function scheduleRun(changedFile: string): void {
    pendingFiles.add(changedFile);

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const changed = Array.from(pendingFiles);
      pendingFiles = new Set();

      // Decide which spec files to re-run
      const specFilesToRun = filesToRerun(changed, specFiles, cwd);

      console.clear();
      if (specFilesToRun.length === 1) {
        console.log(`[Changed: ${path.relative(cwd, changed[0])}]`);
        console.log(`Re-running 1 file...\n`);
      } else {
        console.log(
          `[Changed: ${changed.map((f) => path.relative(cwd, f)).join(", ")}]`,
        );
        console.log(`Re-running ${specFilesToRun.length} file(s)...\n`);
      }

      // Refresh spec list in case files were added/removed
      specFiles = resolveSpecFiles();

      void runAll(specFilesToRun).then(() => {
        printWatchingBanner(specFiles);
      });
    }, 200);
  }

  // ---------------------------------------------------------------------------
  // fs.watch setup
  // ---------------------------------------------------------------------------

  const watchers: fs.FSWatcher[] = [];

  // Watch cwd recursively (covers src/ and spec files)
  try {
    const w = fs.watch(cwd, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const full = path.join(cwd, filename);
      if (shouldWatch(full)) {
        scheduleRun(full);
      }
    });
    watchers.push(w);
  } catch {
    // recursive watch may not be supported on all platforms — fall back silently
    console.warn("[kaze] Warning: recursive fs.watch not available on this platform.");
  }

  // ---------------------------------------------------------------------------
  // Ctrl+C cleanup
  // ---------------------------------------------------------------------------

  const cleanup = () => {
    console.log("\n[kaze] Stopping watcher...");
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        // ignore
      }
    }
    void pool.close().catch(() => {}).finally(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Keep the process alive (watchers are async event emitters)
  await new Promise<never>(() => {
    /* intentionally never resolves — lives until Ctrl+C */
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPEC_SUFFIXES = [".spec.ts", ".spec.js", ".test.ts", ".test.js"];
const SRC_EXTS = [".ts", ".js", ".tsx", ".jsx"];

function isSpecFile(f: string): boolean {
  return SPEC_SUFFIXES.some((s) => f.endsWith(s));
}

function isSrcFile(f: string): boolean {
  return SRC_EXTS.some((s) => f.endsWith(s));
}

function shouldWatch(f: string): boolean {
  // Ignore node_modules and dist
  if (f.includes("/node_modules/") || f.includes("/dist/")) return false;
  return isSpecFile(f) || isSrcFile(f);
}

/**
 * Given changed files, return the spec files to re-run.
 *
 * - Spec file changed → re-run just that file.
 * - Src file changed → re-run all specs (can't determine impact).
 */
function filesToRerun(
  changedFiles: string[],
  allSpecs: string[],
  _cwd: string,
): string[] {
  const hasSrcChange = changedFiles.some((f) => !isSpecFile(f));
  if (hasSrcChange) {
    return allSpecs; // full re-run
  }

  // Only spec files changed — run just those (intersect with known specs)
  const specSet = new Set(allSpecs);
  const targets = changedFiles.filter((f) => isSpecFile(f) && specSet.has(f));
  return targets.length > 0 ? targets : allSpecs;
}

function printWatchingBanner(specFiles: string[]): void {
  const sep = "─".repeat(45);
  console.log(`\n${sep}`);
  console.log(`Watching for changes... (Ctrl+C to quit)`);
  console.log(`${sep}\n`);
  void specFiles; // referenced to avoid unused-var warning
}
