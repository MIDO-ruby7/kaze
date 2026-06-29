/**
 * Locator — Playwright-compatible Locator API.
 *
 * AC-2: page.locator(selector) returns a Locator.
 *       click(), fill(value), textContent()
 */

import type { ClickOptions, FillOptions, TextContentOptions } from "./Page.js";
import type { Page } from "./Page.js";

export class Locator {
  constructor(
    private readonly page: Page,
    readonly selector: string,
  ) {}

  /** Click the element. Waits for the element to appear. */
  async click(opts?: ClickOptions): Promise<void> {
    await this.page.click(this.selector, opts);
  }

  /** Fill the element with a value. Waits for the element to appear. */
  async fill(value: string, opts?: FillOptions): Promise<void> {
    await this.page.fill(this.selector, value, opts);
  }

  /** Return the text content of the element. Waits for the element to appear. */
  async textContent(opts?: TextContentOptions): Promise<string | null> {
    return this.page.textContent(this.selector, opts);
  }

  /**
   * Internal: evaluate JS with the selector in scope.
   * @internal
   */
  async _evaluate(expression: string): Promise<unknown> {
    return this.page._evaluate(expression);
  }

  /**
   * Internal: expose selector for matchers.
   * @internal
   */
  getSelector(): string {
    return this.selector;
  }

  /**
   * Internal: expose page for matchers.
   * @internal
   */
  getPage(): Page {
    return this.page;
  }
}
