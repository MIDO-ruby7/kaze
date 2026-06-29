/**
 * expect — Playwright-compatible assertion API with auto-retry.
 *
 * AC-3:
 *   expect(locator).toHaveText(value)   — auto-retry up to 5s
 *   expect(locator).toBeVisible()       — auto-retry up to 5s
 *   expect(page).toHaveURL(url)
 */

import type { Locator } from "./Locator.js";
import type { Page } from "./Page.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 100;

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

export interface LocatorMatchers {
  toHaveText(expected: string, opts?: { timeout?: number }): Promise<void>;
  toBeVisible(opts?: { timeout?: number }): Promise<void>;
}

export interface PageMatchers {
  toHaveURL(expected: string | RegExp, opts?: { timeout?: number }): Promise<void>;
}

// ---------------------------------------------------------------------------
// LocatorExpect
// ---------------------------------------------------------------------------

class LocatorExpect implements LocatorMatchers {
  constructor(private readonly locator: Locator) {}

  async toHaveText(
    expected: string,
    opts?: { timeout?: number },
  ): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    let lastActual: string | null = null;

    while (Date.now() < deadline) {
      try {
        lastActual = await this.locator.textContent();
        if (lastActual !== null && lastActual.includes(expected)) return;
      } catch {
        // element may not exist yet — keep retrying
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).toHaveText(${JSON.stringify(expected)})\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected text to include: ${JSON.stringify(expected)}\n` +
        `  Received:                 ${JSON.stringify(lastActual)}\n` +
        `  Timeout: ${timeout}ms`,
    );
  }

  async toBeVisible(opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      try {
        const result = await this.locator._evaluate(
          `(function() {
            const el = document.querySelector('${escapeSelector(this.locator.selector)}');
            if (!el) return false;
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          })()`,
        );
        if (result === true) return;
      } catch {
        // keep retrying
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).toBeVisible()\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected element to be visible\n` +
        `  Timeout: ${timeout}ms`,
    );
  }
}

// ---------------------------------------------------------------------------
// PageExpect
// ---------------------------------------------------------------------------

class PageExpect implements PageMatchers {
  constructor(private readonly page: Page) {}

  async toHaveURL(
    expected: string | RegExp,
    opts?: { timeout?: number },
  ): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    let lastUrl = "";

    while (Date.now() < deadline) {
      try {
        lastUrl = await this.page.url();
        if (typeof expected === "string" ? lastUrl === expected : expected.test(lastUrl)) {
          return;
        }
      } catch {
        // keep retrying
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(page).toHaveURL(${String(expected)})\n` +
        `  Expected URL: ${String(expected)}\n` +
        `  Received URL: ${lastUrl}\n` +
        `  Timeout: ${timeout}ms`,
    );
  }
}

// ---------------------------------------------------------------------------
// expect() entry point
// ---------------------------------------------------------------------------

export function expect(target: Locator): LocatorMatchers;
export function expect(target: Page): PageMatchers;
export function expect(target: Locator | Page): LocatorMatchers | PageMatchers {
  // Distinguish Locator vs Page by duck-typing
  if ("selector" in target && "getPage" in target) {
    return new LocatorExpect(target as Locator);
  }
  return new PageExpect(target as Page);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeSelector(selector: string): string {
  return selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}
