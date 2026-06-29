/**
 * Page — Playwright-compatible Page API wrapping a ProtocolAdapter context.
 *
 * AC-1:  goto, click, fill, textContent, waitForSelector, close, locator
 * AC-10: click/fill retry the full waitForSelector→action loop when the element
 *        is detached between the selector check and the actual operation.
 * AC-11: waitForSelector polling stops when the page is cancelled (e.g. after
 *        a Scheduler-level timeout) to prevent stale evaluate calls against a
 *        recycled context.
 */

import type { PooledContext } from "../pool/types.js";
import type { ProtocolAdapter } from "../protocol/index.js";

import { Locator } from "./Locator.js";
import { escapeSelector } from "./utils.js";

/** Returns true when `err` is the "Element not found" error thrown by the adapter. */
function isElementNotFound(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("Element not found:");
}

export interface GotoOptions {
  /** Maximum navigation timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
}

export interface WaitForSelectorOptions {
  /** Maximum wait time in milliseconds. Defaults to 30000. */
  timeout?: number;
}

export interface ClickOptions {
  /** Maximum wait time for the element to appear in milliseconds. Defaults to 30000. */
  timeout?: number;
}

export interface FillOptions {
  /** Maximum wait time for the element to appear in milliseconds. Defaults to 30000. */
  timeout?: number;
}

export interface TextContentOptions {
  /** Maximum wait time for the element to appear in milliseconds. Defaults to 30000. */
  timeout?: number;
}

export class Page {
  /** The contextId of the backing ProtocolAdapter context. */
  readonly contextId: string;

  /**
   * AC-11: Set to true when the page is cancelled (e.g. by Scheduler after a
   * timeout).  waitForSelector checks this flag each iteration so that polling
   * stops immediately after the context is recycled.
   */
  _cancelled = false;

  constructor(
    private readonly adapter: ProtocolAdapter,
    private readonly ctx: PooledContext,
  ) {
    this.contextId = ctx.contextId;
    // AC-11: Register a cancellation hook on the context so that Scheduler can
    // stop polling after a test times out, without importing Page directly.
    ctx._cancel = () => this.cancel();
  }

  /**
   * AC-11: Cancel all in-flight polling on this page.
   * Called by Scheduler (via ctx._cancel) after a test times out, or by
   * close(), to stop waitForSelector loops against an already-recycled context.
   */
  cancel(): void {
    this._cancelled = true;
    // Unregister so that a subsequent Page reusing the same ctx slot starts fresh.
    delete this.ctx._cancel;
  }

  /** Navigate to a URL and wait for the page to load. */
  async goto(url: string, _opts?: GotoOptions): Promise<void> {
    await this.adapter.navigate(this.contextId, url);
  }

  /**
   * Click the first element matching `selector`.
   *
   * AC-1:  Waits for the element to appear before clicking.
   * AC-10: If the element is detached between the waitForSelector check and
   *        the actual dispatchEvent call (e.g. due to a React re-render), the
   *        entire waitForSelector→dispatchEvent sequence is retried until the
   *        deadline is reached.
   */
  async click(selector: string, opts?: ClickOptions): Promise<void> {
    const timeout = opts?.timeout ?? 30_000;
    const deadline = Date.now() + timeout;
    let executed = false;
    while (Date.now() < deadline) {
      executed = true;
      const remaining = deadline - Date.now();
      await this.waitForSelector(selector, { timeout: remaining });
      try {
        await this.adapter.dispatchEvent(this.contextId, selector, "click");
        return;
      } catch (err) {
        if (isElementNotFound(err) && Date.now() < deadline) continue;
        throw err;
      }
    }
    if (!executed) {
      throw new Error(`Timeout ${timeout}ms waiting for selector "${escapeSelector(selector)}"`);
    }
  }

  /**
   * Fill an input element matching `selector` with `value`.
   *
   * AC-2:  Waits for the element to appear before filling.
   * AC-10: If the element is detached between the waitForSelector check and
   *        the evaluate call (e.g. due to a React re-render), the entire
   *        waitForSelector→evaluate sequence is retried until the deadline.
   */
  async fill(selector: string, value: string, opts?: FillOptions): Promise<void> {
    const timeout = opts?.timeout ?? 30_000;
    const deadline = Date.now() + timeout;
    // Focus and set .value via JS, then dispatch input/change events.
    const escapedSel = escapeSelector(selector);
    const escapedVal = value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    let executed = false;
    while (Date.now() < deadline) {
      executed = true;
      const remaining = deadline - Date.now();
      await this.waitForSelector(selector, { timeout: remaining });
      try {
        await this.adapter.evaluate(
          this.contextId,
          `(function() {
            const el = document.querySelector('${escapedSel}');
            if (!el) throw new Error('Element not found: ${escapedSel}');
            el.focus();
            el.value = '${escapedVal}';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          })()`,
        );
        return;
      } catch (err) {
        if (isElementNotFound(err) && Date.now() < deadline) continue;
        throw err;
      }
    }
    if (!executed) {
      throw new Error(`Timeout ${timeout}ms waiting for selector "${escapeSelector(selector)}"`);
    }
  }

  /** Return the text content of the first element matching `selector`. Waits for the element to appear. */
  async textContent(selector: string, opts?: TextContentOptions): Promise<string | null> {
    await this.waitForSelector(selector, opts);
    const escapedSel = escapeSelector(selector);
    const result = await this.adapter.evaluate(
      this.contextId,
      `(function() {
        const el = document.querySelector('${escapedSel}');
        return el ? el.textContent : null;
      })()`,
    );
    if (result === null || result === undefined) return null;
    return String(result);
  }

  /**
   * Wait until an element matching `selector` appears in the DOM.
   *
   * AC-11: The polling loop exits immediately when `this._cancelled` is true
   *        (set by `cancel()` or `close()`).  This prevents stale evaluate
   *        calls against a recycled context after a Scheduler-level timeout.
   */
  async waitForSelector(
    selector: string,
    opts?: WaitForSelectorOptions,
  ): Promise<void> {
    const timeout = opts?.timeout ?? 30_000;
    const interval = 100;
    const deadline = Date.now() + timeout;
    const escapedSel = escapeSelector(selector);

    while (Date.now() < deadline && !this._cancelled) {
      const found = await this.adapter.evaluate(
        this.contextId,
        `!!document.querySelector('${escapedSel}')`,
      );
      if (found) return;
      await delay(interval);
    }

    if (this._cancelled) {
      throw new Error(`Selector wait cancelled for "${selector}"`);
    }

    throw new Error(
      `Timeout ${timeout}ms waiting for selector "${selector}"`,
    );
  }

  /** Return the current URL of the page. */
  async url(): Promise<string> {
    const result = await this.adapter.evaluate(
      this.contextId,
      "window.location.href",
    );
    return String(result);
  }

  /** Create a Locator for elements matching `selector` within this page. */
  locator(selector: string): Locator {
    return new Locator(this, selector);
  }

  /**
   * Close the underlying browser context.
   *
   * AC-11: Cancels in-flight polling first so that waitForSelector loops do
   *        not issue evaluate calls after the context is gone.
   */
  async close(): Promise<void> {
    this.cancel();
    await this.adapter.closeContext(this.contextId);
  }

  /**
   * Internal helper — used by Locator and expect to evaluate JS.
   * @internal
   */
  async _evaluate(expression: string): Promise<unknown> {
    return this.adapter.evaluate(this.contextId, expression);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a Page from a PooledContext.
 * The caller is responsible for supplying the adapter that owns this context.
 */
export function createPage(adapter: ProtocolAdapter, ctx: PooledContext): Page {
  return new Page(adapter, ctx);
}
