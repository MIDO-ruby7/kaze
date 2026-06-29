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

export { test } from "./api/test.js";
export { expect } from "./api/expect.js";
export { Page, createPage } from "./api/Page.js";
export { Locator } from "./api/Locator.js";
export { collectTestCases } from "./api/test.js";

// Re-export types for consumers
export type { GotoOptions, WaitForSelectorOptions } from "./api/Page.js";
export type { LocatorMatchers, PageMatchers } from "./api/expect.js";
