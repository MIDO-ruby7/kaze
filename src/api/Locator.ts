/**
 * Locator — Playwright-compatible Locator API.
 *
 * AC-2: page.locator(selector) returns a Locator.
 *       click(), fill(value), textContent()
 */

import type { Page } from "./Page.js";

export class Locator {
  constructor(
    private readonly page: Page,
    readonly selector: string,
  ) {}

  /** Click the element. */
  async click(): Promise<void> {
    await this.page.click(this.selector);
  }

  /** Fill the element with a value. */
  async fill(value: string): Promise<void> {
    await this.page.fill(this.selector, value);
  }

  /** Return the text content of the element. */
  async textContent(): Promise<string | null> {
    return this.page.textContent(this.selector);
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
