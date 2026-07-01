/**
 * kaze — Playwright-less browser automation toolkit
 */

export const VERSION = "0.0.1";

/**
 * Returns the package name.
 */
export function name(): string {
  return "kaze";
}

// ---------------------------------------------------------------------------
// Playwright-compatible Test API (AC-7)
// ---------------------------------------------------------------------------

export { test, beforeAll, afterAll, beforeEach, afterEach } from "./api/test.js";
export { expect } from "./api/expect.js";
export { Page, createPage } from "./api/Page.js";
export { Locator } from "./api/Locator.js";
export { Route } from "./api/Route.js";
export { collectTestCases, _resetRegistry } from "./api/test.js";

// AI Vision assertions
export { assertScreenshotMatches } from "./ai/vision.js";
export type { VisionAssertResult } from "./ai/vision.js";

// Re-export types for consumers
export type { GotoOptions, WaitForSelectorOptions } from "./api/Page.js";
export type { LocatorMatchers, PageMatchers } from "./api/expect.js";
export type { FulfillOptions } from "./api/Route.js";
export type { GetByTextOptions, AriaRole, GetByRoleOptions, FilterOptions } from "./api/Locator.js";

// ---------------------------------------------------------------------------
// Config API (AC-5)
// ---------------------------------------------------------------------------

export type { KazeConfig } from "./cli/config.js";

/**
 * defineConfig — identity helper that enables TypeScript type inference
 * for kaze.config.ts files.
 *
 * @example
 * ```typescript
 * import { defineConfig } from "kaze"
 * export default defineConfig({ workers: 20 })
 * ```
 */
export function defineConfig(config: import("./cli/config.js").KazeConfig): import("./cli/config.js").KazeConfig {
  return config;
}
