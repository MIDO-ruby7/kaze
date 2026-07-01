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
import { escapeSelector } from "./utils.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_VISIBILITY_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 100;

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

export interface LocatorMatchers {
  toHaveText(expected: string, opts?: { timeout?: number }): Promise<void>;
  toBeVisible(opts?: { timeout?: number }): Promise<void>;
  toBeChecked(opts?: { timeout?: number }): Promise<void>;
  toBeEnabled(opts?: { timeout?: number }): Promise<void>;
  toBeDisabled(opts?: { timeout?: number }): Promise<void>;
  toHaveValue(expected: string, opts?: { timeout?: number }): Promise<void>;
  toHaveCount(expected: number, opts?: { timeout?: number }): Promise<void>;
  toHaveClass(expected: string | RegExp, opts?: { timeout?: number }): Promise<void>;
  toHaveAttribute(name: string, value: string | RegExp, opts?: { timeout?: number }): Promise<void>;
  toContainText(expected: string | RegExp, opts?: { timeout?: number }): Promise<void>;
  /** Negated matchers — each method asserts the inverse condition. */
  readonly not: LocatorMatchers;
}

export interface PageMatchers {
  toHaveURL(expected: string | RegExp, opts?: { timeout?: number }): Promise<void>;
  toHaveTitle(expected: string | RegExp, opts?: { timeout?: number }): Promise<void>;
}

// ---------------------------------------------------------------------------
// LocatorExpect
// ---------------------------------------------------------------------------

class LocatorExpect implements LocatorMatchers {
  constructor(private readonly locator: Locator) {}

  /** Negated matchers — asserts the inverse of each condition. */
  get not(): LocatorMatchers {
    return new NegatedLocatorExpect(this.locator);
  }

  async toHaveText(
    expected: string,
    opts?: { timeout?: number },
  ): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    let lastActual: string | null = null;

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        // Pass a short single-poll timeout so waitForSelector doesn't block
        // longer than one polling interval, letting this outer loop retry.
        lastActual = await this.locator.textContent({ timeout: POLL_INTERVAL_MS });
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
    const timeout = opts?.timeout ?? DEFAULT_VISIBILITY_TIMEOUT_MS;
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

  /**
   * Assert that a checkbox/radio is checked. Auto-retries.
   * AC-3 (Issue #31)
   */
  async toBeChecked(opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      try {
        const result = await this.locator._evaluate(
          `(function() {
            const el = document.querySelector('${escapeSelector(this.locator.selector)}');
            return el ? el.checked === true : false;
          })()`,
        );
        if (result === true) return;
      } catch {
        // keep retrying
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).toBeChecked()\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected element to be checked\n` +
        `  Timeout: ${timeout}ms`,
    );
  }

  /**
   * Assert that an element is enabled (not disabled). Auto-retries.
   * AC-3 (Issue #31)
   */
  async toBeEnabled(opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      try {
        const result = await this.locator._evaluate(
          `(function() {
            const el = document.querySelector('${escapeSelector(this.locator.selector)}');
            return el ? !el.disabled : false;
          })()`,
        );
        if (result === true) return;
      } catch {
        // keep retrying
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).toBeEnabled()\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected element to be enabled\n` +
        `  Timeout: ${timeout}ms`,
    );
  }

  /**
   * Assert that an element is disabled. Auto-retries.
   * AC-3 / AC-11 (Issue #31): also throws if element is not found.
   */
  async toBeDisabled(opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    let lastResult: { found: boolean; disabled: boolean } | null = null;

    while (Date.now() < deadline) {
      try {
        const result = await this.locator._evaluate(
          `(function() {
            const el = document.querySelector('${escapeSelector(this.locator.selector)}');
            if (!el) return { found: false, disabled: false };
            return { found: true, disabled: el.disabled === true };
          })()`,
        ) as { found: boolean; disabled: boolean };
        lastResult = result;
        if (result.found && result.disabled) return;
        // Element found but not disabled — keep retrying until timeout
        // Element not found — keep retrying until timeout
      } catch {
        // keep retrying
      }
      await delay(POLL_INTERVAL_MS);
    }

    if (lastResult !== null && !lastResult.found) {
      throw new AssertionError(
        `expect(locator).toBeDisabled()\n` +
          `  Selector: ${this.locator.selector}\n` +
          `  Element not found\n` +
          `  Timeout: ${timeout}ms`,
      );
    }

    throw new AssertionError(
      `expect(locator).toBeDisabled()\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected element to be disabled\n` +
        `  Timeout: ${timeout}ms`,
    );
  }

  /**
   * Assert that an input/textarea has the given value. Auto-retries.
   * AC-3 (Issue #31)
   */
  async toHaveValue(expected: string, opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;
    let lastActual: string | null = null;

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        lastActual = await this.locator.inputValue({ timeout: POLL_INTERVAL_MS });
        if (lastActual === expected) return;
      } catch {
        // keep retrying
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).toHaveValue(${JSON.stringify(expected)})\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected value: ${JSON.stringify(expected)}\n` +
        `  Received:       ${JSON.stringify(lastActual)}\n` +
        `  Timeout: ${timeout}ms`,
    );
  }

  /**
   * Assert that the selector matches exactly n elements. Auto-retries.
   * AC-3 (Issue #31)
   */
  async toHaveCount(expected: number, opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;
    let lastActual = -1;

    while (Date.now() < deadline) {
      try {
        lastActual = await this.locator.count();
        if (lastActual === expected) return;
      } catch {
        // keep retrying
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).toHaveCount(${expected})\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected count: ${expected}\n` +
        `  Received:       ${lastActual}\n` +
        `  Timeout: ${timeout}ms`,
    );
  }

  /**
   * Assert that the element has the expected class (partial string match or RegExp).
   * Auto-retries. AC-1 (Issue #45)
   */
  async toHaveClass(
    expected: string | RegExp,
    opts?: { timeout?: number },
  ): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;
    let lastActual: string | null = null;

    while (Date.now() < deadline) {
      try {
        const result = await this.locator._evaluate(
          `(function() {
            const el = document.querySelector('${escapeSelector(this.locator.selector)}');
            return el ? el.className : null;
          })()`,
        );
        lastActual = result !== null && result !== undefined ? String(result) : null;
        if (lastActual !== null) {
          const classes = lastActual.split(/\s+/).filter(Boolean);
          const matched =
            typeof expected === "string"
              ? classes.includes(expected)
              : expected.test(lastActual);
          if (matched) return;
        }
      } catch {
        // keep retrying
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).toHaveClass(${String(expected)})\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected class to match: ${String(expected)}\n` +
        `  Received:                ${JSON.stringify(lastActual)}\n` +
        `  Timeout: ${timeout}ms`,
    );
  }

  /**
   * Assert that the element has an attribute with the expected value.
   * Auto-retries. AC-2 (Issue #45)
   */
  async toHaveAttribute(
    name: string,
    value: string | RegExp,
    opts?: { timeout?: number },
  ): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;
    let lastActual: string | null = null;
    const escapedName = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

    while (Date.now() < deadline) {
      try {
        const result = await this.locator._evaluate(
          `(function() {
            const el = document.querySelector('${escapeSelector(this.locator.selector)}');
            if (!el) return null;
            const val = el.getAttribute('${escapedName}');
            return val === undefined ? null : val;
          })()`,
        );
        lastActual = result !== null && result !== undefined ? String(result) : null;
        if (lastActual !== null) {
          const matched =
            typeof value === "string"
              ? lastActual === value
              : value.test(lastActual);
          if (matched) return;
        }
      } catch {
        // keep retrying
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).toHaveAttribute(${JSON.stringify(name)}, ${String(value)})\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected attribute "${name}" to match: ${String(value)}\n` +
        `  Received:                               ${JSON.stringify(lastActual)}\n` +
        `  Timeout: ${timeout}ms`,
    );
  }

  /**
   * Assert that the element's text content contains the expected string/RegExp.
   * Native implementation without shim — uses polling loop like toHaveText.
   * AC-3 (Issue #45)
   */
  async toContainText(
    expected: string | RegExp,
    opts?: { timeout?: number },
  ): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;
    let lastActual: string | null = null;

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        lastActual = await this.locator.textContent({ timeout: POLL_INTERVAL_MS });
        if (lastActual !== null) {
          const matched =
            typeof expected === "string"
              ? lastActual.includes(expected)
              : expected.test(lastActual);
          if (matched) return;
        }
      } catch {
        // element may not exist yet — keep retrying
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).toContainText(${String(expected)})\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected text to contain: ${String(expected)}\n` +
        `  Received:                 ${JSON.stringify(lastActual)}\n` +
        `  Timeout: ${timeout}ms`,
    );
  }
}

// ---------------------------------------------------------------------------
// NegatedLocatorExpect — inverts every assertion
// ---------------------------------------------------------------------------

class NegatedLocatorExpect implements LocatorMatchers {
  constructor(private readonly locator: Locator) {}

  /** not.not is not supported; returns itself to avoid crashes. */
  get not(): LocatorMatchers {
    return new LocatorExpect(this.locator);
  }

  async toHaveText(expected: string, opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;
    let lastActual: string | null = null;

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        lastActual = await this.locator.textContent({ timeout: POLL_INTERVAL_MS });
        if (lastActual === null || !lastActual.includes(expected)) return;
      } catch {
        return; // element absent — condition satisfied
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).not.toHaveText(${JSON.stringify(expected)})\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected text NOT to include: ${JSON.stringify(expected)}\n` +
        `  Received: ${JSON.stringify(lastActual)}\n` +
        `  Timeout: ${timeout}ms`,
    );
  }

  async toBeVisible(opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_VISIBILITY_TIMEOUT_MS;
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
        if (result !== true) return;
      } catch {
        return; // element absent — not visible
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).not.toBeVisible()\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected element NOT to be visible\n` +
        `  Timeout: ${timeout}ms`,
    );
  }

  async toBeChecked(opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      try {
        const result = await this.locator._evaluate(
          `(function() {
            const el = document.querySelector('${escapeSelector(this.locator.selector)}');
            return el ? el.checked === true : false;
          })()`,
        );
        if (result !== true) return;
      } catch {
        return;
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).not.toBeChecked()\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected element NOT to be checked\n` +
        `  Timeout: ${timeout}ms`,
    );
  }

  async toBeEnabled(opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      try {
        const result = await this.locator._evaluate(
          `(function() {
            const el = document.querySelector('${escapeSelector(this.locator.selector)}');
            return el ? !el.disabled : false;
          })()`,
        );
        if (result !== true) return;
      } catch {
        return;
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).not.toBeEnabled()\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected element NOT to be enabled\n` +
        `  Timeout: ${timeout}ms`,
    );
  }

  async toBeDisabled(opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      try {
        const result = await this.locator._evaluate(
          `(function() {
            const el = document.querySelector('${escapeSelector(this.locator.selector)}');
            if (!el) return false;
            return el.disabled === true;
          })()`,
        );
        if (result !== true) return;
      } catch {
        return;
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).not.toBeDisabled()\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected element NOT to be disabled\n` +
        `  Timeout: ${timeout}ms`,
    );
  }

  async toHaveValue(expected: string, opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;
    let lastActual: string | null = null;

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        lastActual = await this.locator.inputValue({ timeout: POLL_INTERVAL_MS });
        if (lastActual !== expected) return;
      } catch {
        return;
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).not.toHaveValue(${JSON.stringify(expected)})\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected value NOT to be: ${JSON.stringify(expected)}\n` +
        `  Received: ${JSON.stringify(lastActual)}\n` +
        `  Timeout: ${timeout}ms`,
    );
  }

  async toHaveCount(expected: number, opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;
    let lastActual = -1;

    while (Date.now() < deadline) {
      try {
        lastActual = await this.locator.count();
        if (lastActual !== expected) return;
      } catch {
        return;
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).not.toHaveCount(${expected})\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected count NOT to be: ${expected}\n` +
        `  Received: ${lastActual}\n` +
        `  Timeout: ${timeout}ms`,
    );
  }

  async toHaveClass(expected: string | RegExp, opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;
    let lastActual: string | null = null;

    while (Date.now() < deadline) {
      try {
        const result = await this.locator._evaluate(
          `(function() {
            const el = document.querySelector('${escapeSelector(this.locator.selector)}');
            return el ? el.className : null;
          })()`,
        );
        lastActual = result !== null && result !== undefined ? String(result) : null;
        if (lastActual !== null) {
          const classes = lastActual.split(/\s+/).filter(Boolean);
          const matched =
            typeof expected === "string"
              ? classes.includes(expected)
              : expected.test(lastActual);
          if (!matched) return;
        }
      } catch {
        return;
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).not.toHaveClass(${String(expected)})\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected class NOT to match: ${String(expected)}\n` +
        `  Received: ${JSON.stringify(lastActual)}\n` +
        `  Timeout: ${timeout}ms`,
    );
  }

  async toHaveAttribute(
    name: string,
    value: string | RegExp,
    opts?: { timeout?: number },
  ): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;
    let lastActual: string | null = null;
    const escapedName = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

    while (Date.now() < deadline) {
      try {
        const result = await this.locator._evaluate(
          `(function() {
            const el = document.querySelector('${escapeSelector(this.locator.selector)}');
            if (!el) return null;
            const val = el.getAttribute('${escapedName}');
            return val === undefined ? null : val;
          })()`,
        );
        lastActual = result !== null && result !== undefined ? String(result) : null;
        if (lastActual !== null) {
          const matched =
            typeof value === "string" ? lastActual === value : value.test(lastActual);
          if (!matched) return;
        } else {
          return; // attribute absent — condition satisfied
        }
      } catch {
        return;
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).not.toHaveAttribute(${JSON.stringify(name)}, ${String(value)})\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected attribute "${name}" NOT to match: ${String(value)}\n` +
        `  Received: ${JSON.stringify(lastActual)}\n` +
        `  Timeout: ${timeout}ms`,
    );
  }

  async toContainText(expected: string | RegExp, opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;
    let lastActual: string | null = null;

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        lastActual = await this.locator.textContent({ timeout: POLL_INTERVAL_MS });
        if (lastActual !== null) {
          const matched =
            typeof expected === "string"
              ? lastActual.includes(expected)
              : expected.test(lastActual);
          if (!matched) return;
        }
      } catch {
        return;
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(locator).not.toContainText(${String(expected)})\n` +
        `  Selector: ${this.locator.selector}\n` +
        `  Expected text NOT to contain: ${String(expected)}\n` +
        `  Received: ${JSON.stringify(lastActual)}\n` +
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

  /**
   * Assert that the page title matches. Auto-retries.
   * AC-3 (Issue #31)
   */
  async toHaveTitle(
    expected: string | RegExp,
    opts?: { timeout?: number },
  ): Promise<void> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;
    let lastTitle = "";

    while (Date.now() < deadline) {
      try {
        lastTitle = await this.page.title();
        if (typeof expected === "string" ? lastTitle === expected : expected.test(lastTitle)) {
          return;
        }
      } catch {
        // keep retrying
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new AssertionError(
      `expect(page).toHaveTitle(${String(expected)})\n` +
        `  Expected title: ${String(expected)}\n` +
        `  Received title: ${lastTitle}\n` +
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

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}
