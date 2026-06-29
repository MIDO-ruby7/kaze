/**
 * config.ts — kaze.config.ts / kaze.config.js loader and merge utility.
 *
 * AC-1: Loads kaze.config.ts or kaze.config.js from the project root.
 * AC-2: Supports workers, timeout, reporter, testMatch, screenshot fields.
 * AC-3: CLI flags override config file values (see mergeConfig).
 * AC-4: Returns empty config when no config file exists.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KazeConfig {
  workers?: number;
  timeout?: number;
  reporter?: "verbose" | "dot";
  testMatch?: string[];
  screenshot?: boolean;
}

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

/**
 * Reads kaze.config.ts (preferred) or kaze.config.js from `cwd`.
 * Returns an empty object when neither file is found.
 */
export async function loadConfig(cwd: string): Promise<KazeConfig> {
  for (const name of ["kaze.config.ts", "kaze.config.js"]) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) {
      // Use a cache-busting query param so repeated calls in tests get fresh modules.
      const url = pathToFileURL(p).href + "?t=" + Date.now();
      const mod = await import(url);
      return (mod.default ?? mod) as KazeConfig;
    }
  }
  return {};
}

// ---------------------------------------------------------------------------
// mergeConfig
// ---------------------------------------------------------------------------

/**
 * Merges file-based config with CLI overrides.
 * CLI values win only when they are not `undefined`.
 */
export function mergeConfig(
  fileConfig: KazeConfig,
  cliOverrides: KazeConfig
): KazeConfig {
  const result: KazeConfig = { ...fileConfig };

  if (cliOverrides.workers !== undefined) result.workers = cliOverrides.workers;
  if (cliOverrides.timeout !== undefined) result.timeout = cliOverrides.timeout;
  if (cliOverrides.reporter !== undefined)
    result.reporter = cliOverrides.reporter;
  if (cliOverrides.testMatch !== undefined)
    result.testMatch = cliOverrides.testMatch;
  if (cliOverrides.screenshot !== undefined)
    result.screenshot = cliOverrides.screenshot;

  return result;
}
