/**
 * Page — Playwright-compatible Page API wrapping a ProtocolAdapter context.
 *
 * AC-1: goto, click, fill, textContent, waitForSelector, close, locator
 */

import type { PooledContext } from "../pool/types.js";
import type { ProtocolAdapter } from "../protocol/index.js";

import { Locator } from "./Locator.js";

export interface GotoOptions {
  /** Maximum navigation timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
}

export interface WaitForSelectorOptions {
  /** Maximum wait time in milliseconds. Defaults to 30000. */
  timeout?: number;
}

export class Page {
  /** The contextId of the backing ProtocolAdapter context. */
  readonly contextId: string;

  constructor(
    private readonly adapter: ProtocolAdapter,
    private readonly ctx: PooledContext,
  ) {
    this.contextId = ctx.contextId;
  }

  /** Navigate to a URL and wait for the page to load. */
  async goto(url: string, _opts?: GotoOptions): Promise<void> {
    await this.adapter.navigate(this.contextId, url);
  }

  /** Click the first element matching `selector`. */
  async click(selector: string): Promise<void> {
    await this.adapter.dispatchEvent(this.contextId, selector, "click");
  }

  /** Fill an input element matching `selector` with `value`. */
  async fill(selector: string, value: string): Promise<void> {
    // Focus and set .value via JS, then dispatch input/change events.
    const escaped = value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    await this.adapter.evaluate(
      this.contextId,
      `(function() {
        const el = document.querySelector('${selector}');
        if (!el) throw new Error('Element not found: ${selector}');
        el.focus();
        el.value = '${escaped}';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`,
    );
  }

  /** Return the text content of the first element matching `selector`. */
  async textContent(selector: string): Promise<string | null> {
    const result = await this.adapter.evaluate(
      this.contextId,
      `(function() {
        const el = document.querySelector('${selector}');
        return el ? el.textContent : null;
      })()`,
    );
    if (result === null || result === undefined) return null;
    return String(result);
  }

  /** Wait until an element matching `selector` appears in the DOM. */
  async waitForSelector(
    selector: string,
    opts?: WaitForSelectorOptions,
  ): Promise<void> {
    const timeout = opts?.timeout ?? 30_000;
    const interval = 100;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const found = await this.adapter.evaluate(
        this.contextId,
        `!!document.querySelector('${selector}')`,
      );
      if (found) return;
      await delay(interval);
    }

    throw new Error(
      `Timeout waiting for selector "${selector}" after ${timeout}ms`,
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

  /** Close the underlying browser context. */
  async close(): Promise<void> {
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
