/**
 * runner.ts — file detection, pool construction, and test execution.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { register } from "node:module";

import { BrowserPool } from "../pool/BrowserPool.js";
import { Scheduler } from "../scheduler/Scheduler.js";
import { collectTestCases } from "../api/test.js";
import type { TestResult } from "../scheduler/types.js";

// ---------------------------------------------------------------------------
// Register vitest stub loader so spec files that import vitest directly work
// under the kaze CLI (where vitest's internal state is not initialised).
// ---------------------------------------------------------------------------

const _loaderUrl = new URL("./vitest-stub-loader.js", import.meta.url).href;
try {
  register(_loaderUrl, import.meta.url);
} catch {
  // register() may throw if called after module loading has started;
  // best-effort — if it fails the runner will still work for .js spec files.
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunOptions {
  /** Glob pattern or directory to search. Defaults to cwd if undefined. */
  pattern?: string;
  /** Max parallel test workers. */
  workers?: number;
  /** Per-test timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
}

// ---------------------------------------------------------------------------
// File detection
// ---------------------------------------------------------------------------

const SPEC_SUFFIXES = [".spec.ts", ".spec.js", ".test.ts", ".test.js"];

function isSpecFile(filePath: string): boolean {
  return SPEC_SUFFIXES.some((s) => filePath.endsWith(s));
}

/**
 * Detect spec files given a pattern or directory path.
 *
 * - If pattern is an existing directory, scan it recursively.
 * - Otherwise treat the pattern as a literal file path (basic glob support
 *   limited to directory prefix matching for now, using Node.js 22 recursive
 *   readdirSync).
 */
export function detectFiles(pattern: string | undefined, cwd: string): string[] {
  const root = cwd;

  // No pattern → scan entire cwd
  if (!pattern) {
    return scanDir(root).sort();
  }

  const candidate = path.isAbsolute(pattern) ? pattern : path.join(root, pattern);

  // Directory
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    return scanDir(candidate).sort();
  }

  // Direct file reference
  if (fs.existsSync(candidate) && isSpecFile(candidate)) {
    return [candidate];
  }

  // Glob-like: walk the cwd and filter by the pattern
  // Support patterns like "**/*.spec.ts" and "src/**/*.spec.ts"
  const allFiles = scanDir(root);
  const matchedFiles = allFiles.filter((f) => matchGlob(pattern, f, root));
  return matchedFiles.sort();
}

function scanDir(dir: string): string[] {
  const results: string[] = [];
  try {
    // Node.js 22: fs.readdirSync with recursive option
    const entries = fs.readdirSync(dir, { recursive: true, encoding: "utf-8" }) as string[];
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isFile() && isSpecFile(full)) {
        results.push(full);
      }
    }
  } catch {
    // If the directory doesn't exist or isn't readable, return empty
  }
  return results;
}

/**
 * Minimal glob matching: supports `**` and `*` wildcards.
 * The pattern is matched against the relative path from root.
 */
function matchGlob(pattern: string, filePath: string, root: string): boolean {
  const rel = path.relative(root, filePath);
  // Normalize separators
  const normalizedRel = rel.split(path.sep).join("/");
  const normalizedPattern = pattern.split(path.sep).join("/");

  // Convert glob pattern to RegExp
  const regexStr = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape special regex chars (not * and ?)
    .replace(/\*\*/g, "\x00") // placeholder for **
    .replace(/\*/g, "[^/]*") // * matches anything except /
    .replace(/\x00/g, ".*") // ** matches anything including /
    .replace(/\?/g, "[^/]"); // ? matches single char except /

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(normalizedRel);
}

// ---------------------------------------------------------------------------
// Test import
// ---------------------------------------------------------------------------

/**
 * Import a spec file so its top-level `test(...)` calls register into the
 * global registry. Uses tsx/esm if available for TypeScript files.
 */
async function importSpecFile(filePath: string): Promise<void> {
  const fileUrl = url.pathToFileURL(filePath).href;

  if (filePath.endsWith(".ts")) {
    // Check if tsx is available in node_modules
    const tsxPath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "../../node_modules/tsx/dist/esm/index.cjs");
    if (fs.existsSync(tsxPath)) {
      // tsx is available — use dynamic import with tsx/esm loader
      // When running under `tsx src/cli/index.ts`, TypeScript files can be
      // imported directly since tsx already hooks Node's loader.
      await import(fileUrl);
      return;
    }
    // tsx not found — skip TypeScript files with a warning
    console.warn(`[kaze] Skipping ${filePath}: tsx not available for TypeScript import`);
    return;
  }

  await import(fileUrl);
}

// ---------------------------------------------------------------------------
// Main run function
// ---------------------------------------------------------------------------

export async function run(opts: RunOptions): Promise<TestResult[]> {
  const cwd = process.cwd();
  const envWorkers = parseInt(process.env.KAZE_WORKERS ?? "0", 10) || undefined;
  const workers = opts.workers ?? envWorkers;
  const timeout = opts.timeout ?? 30_000;

  // 1. Detect spec files
  const files = detectFiles(opts.pattern, cwd);

  if (files.length === 0) {
    console.log("[kaze] No spec files found.");
    return [];
  }

  console.log(`[kaze] Found ${files.length} spec file(s)`);

  // 2. Import all spec files (registers test cases)
  for (const f of files) {
    await importSpecFile(f);
  }

  // 3. Build pool
  const pool = new BrowserPool();
  try {
    await pool.init({ workers });

    // 4. Collect test cases
    const cases = collectTestCases(pool);

    if (cases.length === 0) {
      console.log("[kaze] No test cases registered.");
      return [];
    }

    // Apply timeout override if provided
    if (timeout !== 30_000) {
      for (const c of cases) {
        if (c.timeout === undefined) {
          (c as { timeout?: number }).timeout = timeout;
        }
      }
    }

    // 5. Run
    const scheduler = new Scheduler(pool);
    scheduler.enqueue(cases);
    return await scheduler.run();
  } finally {
    await pool.close().catch(() => {});
  }
}
