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
  reporter?: "verbose" | "dot" | "html";
  testMatch?: string[];
  screenshot?: boolean;
  /** Regex pattern: only run tests whose name matches. */
  grep?: string;
  /** Regex pattern: skip tests whose name matches. */
  grepInvert?: string;
  /** Default number of retries for all tests. */
  retries?: number;
  /** Shard specification: "index/total" string or object form (AC-4). */
  shard?: string | { index: number; total: number };
}

// ---------------------------------------------------------------------------
// validateConfig (AC-9)
// ---------------------------------------------------------------------------

/**
 * Validates the raw config object loaded from the config file.
 * Exits with code 2 and an error message if any field has an invalid type/value.
 */
function validateConfig(cfg: unknown): KazeConfig {
  const result: KazeConfig = {};
  if (typeof cfg !== "object" || cfg === null) return result;
  const c = cfg as Record<string, unknown>;

  if (c.workers !== undefined) {
    if (
      typeof c.workers !== "number" ||
      !Number.isInteger(c.workers) ||
      c.workers < 1
    ) {
      console.error(
        `[kaze] Config error: "workers" must be a positive integer (got ${JSON.stringify(c.workers)})`
      );
      process.exit(2);
    }
    result.workers = c.workers;
  }

  if (c.timeout !== undefined) {
    if (
      typeof c.timeout !== "number" ||
      !Number.isInteger(c.timeout) ||
      c.timeout < 1
    ) {
      console.error(
        `[kaze] Config error: "timeout" must be a positive integer (got ${JSON.stringify(c.timeout)})`
      );
      process.exit(2);
    }
    result.timeout = c.timeout;
  }

  if (c.reporter !== undefined) {
    if (c.reporter !== "verbose" && c.reporter !== "dot" && c.reporter !== "html") {
      console.error(
        `[kaze] Config error: "reporter" must be "verbose", "dot", or "html" (got ${JSON.stringify(c.reporter)})`
      );
      process.exit(2);
    }
    result.reporter = c.reporter as "verbose" | "dot" | "html";
  }

  if (c.screenshot !== undefined) {
    if (typeof c.screenshot !== "boolean") {
      console.error(
        `[kaze] Config error: "screenshot" must be a boolean (got ${JSON.stringify(c.screenshot)})`
      );
      process.exit(2);
    }
    result.screenshot = c.screenshot;
  }

  if (c.testMatch !== undefined) {
    if (
      !Array.isArray(c.testMatch) ||
      !(c.testMatch as unknown[]).every((v) => typeof v === "string")
    ) {
      console.error(
        `[kaze] Config error: "testMatch" must be an array of strings (got ${JSON.stringify(c.testMatch)})`
      );
      process.exit(2);
    }
    result.testMatch = c.testMatch as string[];
  }

  if (c.grep !== undefined) {
    if (typeof c.grep !== "string") {
      console.error(
        `[kaze] Config error: "grep" must be a string (got ${JSON.stringify(c.grep)})`
      );
      process.exit(2);
    }
    result.grep = c.grep;
  }

  if (c.grepInvert !== undefined) {
    if (typeof c.grepInvert !== "string") {
      console.error(
        `[kaze] Config error: "grepInvert" must be a string (got ${JSON.stringify(c.grepInvert)})`
      );
      process.exit(2);
    }
    result.grepInvert = c.grepInvert;
  }

  if (c.retries !== undefined) {
    if (
      typeof c.retries !== "number" ||
      !Number.isInteger(c.retries) ||
      c.retries < 0
    ) {
      console.error(
        `[kaze] Config error: "retries" must be a non-negative integer (got ${JSON.stringify(c.retries)})`
      );
      process.exit(2);
    }
    result.retries = c.retries;
  }

  if (c.shard !== undefined) {
    const isString = typeof c.shard === "string";
    const isObject =
      typeof c.shard === "object" &&
      c.shard !== null &&
      typeof (c.shard as Record<string, unknown>).index === "number" &&
      typeof (c.shard as Record<string, unknown>).total === "number";
    if (!isString && !isObject) {
      console.error(
        `[kaze] Config error: "shard" must be a string like "1/3" or an object { index, total } (got ${JSON.stringify(c.shard)})`
      );
      process.exit(2);
    }
    result.shard = c.shard as KazeConfig["shard"];
  }

  return result;
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
      return validateConfig(mod.default ?? mod);
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
  if (cliOverrides.grep !== undefined) result.grep = cliOverrides.grep;
  if (cliOverrides.grepInvert !== undefined) result.grepInvert = cliOverrides.grepInvert;
  if (cliOverrides.retries !== undefined) result.retries = cliOverrides.retries;
  if (cliOverrides.shard !== undefined) result.shard = cliOverrides.shard;

  return result;
}
