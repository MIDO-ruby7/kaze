/**
 * Locator — Playwright-compatible Locator API.
 *
 * AC-2: page.locator(selector) returns a Locator.
 *       click(), fill(value), textContent()
 * AC-1 (Issue #31): all(), count(), check(), uncheck(), selectOption(),
 *       hover(), isVisible(), isEnabled(), inputValue()
 */

import type { ClickOptions, FillOptions, TextContentOptions } from "./Page.js";
import type { Page } from "./Page.js";
import { escapeSelector } from "./utils.js";

export interface CheckOptions {
  /** Maximum wait time in milliseconds. Defaults to 30000. */
  timeout?: number;
}

export interface SelectOptionValue {
  /** Select by option label text. */
  label?: string;
  /** Select by option value attribute. */
  value?: string;
}

export interface SelectOptionOptions {
  /** Maximum wait time in milliseconds. Defaults to 30000. */
  timeout?: number;
}

export interface HoverOptions {
  /** Maximum wait time in milliseconds. Defaults to 30000. */
  timeout?: number;
}

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
   * Return the number of elements matching the selector.
   * AC-1 (Issue #31)
   */
  async count(): Promise<number> {
    const escapedSel = escapeSelector(this.selector);
    const result = await this.page._evaluate(
      `document.querySelectorAll('${escapedSel}').length`,
    );
    return Number(result);
  }

  /**
   * Return all matching elements as an array of Locators.
   * AC-7 (Issue #31): Each returned Locator resolves to querySelectorAll(selector)[i]
   * regardless of sibling structure. Uses data-kaze-idx attributes to uniquely
   * identify each matched element by index rather than CSS :nth-child position.
   */
  async all(): Promise<Locator[]> {
    const n = await this.count();
    if (n === 0) return [];

    const escapedSel = escapeSelector(this.selector);
    // Assign a unique data-kaze-idx attribute to each matched element so that
    // each returned Locator can target it precisely via [data-kaze-idx="i"].
    // This avoids :nth-child which is sibling-position-based, not match-index-based.
    await this.page._evaluate(
      `(function() {
        const els = document.querySelectorAll('${escapedSel}');
        els.forEach(function(el, i) { el.setAttribute('data-kaze-idx', String(i)); });
      })()`,
    );

    return Array.from({ length: n }, (_, i) =>
      new Locator(this.page, `[data-kaze-idx="${i}"]`),
    );
  }

  /**
   * Check a checkbox or radio button. Waits for the element to appear.
   * AC-1 (Issue #31)
   */
  async check(opts?: CheckOptions): Promise<void> {
    await this.page.waitForSelector(this.selector, opts);
    const escapedSel = escapeSelector(this.selector);
    await this.page._evaluate(
      `(function() {
        const el = document.querySelector('${escapedSel}');
        if (!el) throw new Error('Element not found: ${escapedSel}');
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`,
    );
  }

  /**
   * Uncheck a checkbox. Waits for the element to appear.
   * AC-1 (Issue #31)
   */
  async uncheck(opts?: CheckOptions): Promise<void> {
    await this.page.waitForSelector(this.selector, opts);
    const escapedSel = escapeSelector(this.selector);
    await this.page._evaluate(
      `(function() {
        const el = document.querySelector('${escapedSel}');
        if (!el) throw new Error('Element not found: ${escapedSel}');
        el.checked = false;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`,
    );
  }

  /**
   * Select an option in a <select> element.
   * Accepts a string (value), number (index), or { label } / { value } object.
   * Waits for the element to appear.
   * AC-1 (Issue #31)
   */
  async selectOption(
    value: string | number | SelectOptionValue,
    opts?: SelectOptionOptions,
  ): Promise<void> {
    await this.page.waitForSelector(this.selector, opts);
    const escapedSel = escapeSelector(this.selector);

    let script: string;
    if (typeof value === "number") {
      script = `(function() {
        const el = document.querySelector('${escapedSel}');
        if (!el) throw new Error('Element not found: ${escapedSel}');
        el.selectedIndex = ${value};
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`;
    } else if (typeof value === "string") {
      const escapedValue = value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      script = `(function() {
        const el = document.querySelector('${escapedSel}');
        if (!el) throw new Error('Element not found: ${escapedSel}');
        const opt = Array.from(el.options).find(o => o.value === '${escapedValue}');
        if (!opt) throw new Error('Option not found for selector "${escapedSel}" with value "${escapedValue}"');
        opt.selected = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`;
    } else if (value.label !== undefined) {
      const escapedLabel = value.label.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      script = `(function() {
        const el = document.querySelector('${escapedSel}');
        if (!el) throw new Error('Element not found: ${escapedSel}');
        const opt = Array.from(el.options).find(o => o.text === '${escapedLabel}');
        if (!opt) throw new Error('Option not found for selector "${escapedSel}" with label "${escapedLabel}"');
        opt.selected = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`;
    } else {
      const escapedValue = (value.value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      script = `(function() {
        const el = document.querySelector('${escapedSel}');
        if (!el) throw new Error('Element not found: ${escapedSel}');
        const opt = Array.from(el.options).find(o => o.value === '${escapedValue}');
        if (!opt) throw new Error('Option not found for selector "${escapedSel}" with value "${escapedValue}"');
        opt.selected = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`;
    }

    await this.page._evaluate(script);
  }

  /**
   * Hover over the element. Waits for the element to appear.
   * AC-1 (Issue #31)
   */
  async hover(opts?: HoverOptions): Promise<void> {
    await this.page.waitForSelector(this.selector, opts);
    await this.page._dispatchEvent(this.selector, "mouseover");
  }

  /**
   * Return whether the element is currently visible. No auto-waiting.
   * AC-1 (Issue #31)
   */
  async isVisible(): Promise<boolean> {
    const escapedSel = escapeSelector(this.selector);
    const result = await this.page._evaluate(
      `(function() {
        const el = document.querySelector('${escapedSel}');
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      })()`,
    );
    return result === true;
  }

  /**
   * Return whether the element is currently enabled (not disabled). No auto-waiting.
   * AC-1 (Issue #31)
   */
  async isEnabled(): Promise<boolean> {
    const escapedSel = escapeSelector(this.selector);
    const result = await this.page._evaluate(
      `(function() {
        const el = document.querySelector('${escapedSel}');
        if (!el) return false;
        return !el.disabled;
      })()`,
    );
    return result === true;
  }

  /**
   * Return the current value of an input or textarea. Waits for the element to appear.
   * AC-1 (Issue #31)
   */
  async inputValue(opts?: { timeout?: number }): Promise<string> {
    await this.page.waitForSelector(this.selector, opts);
    const escapedSel = escapeSelector(this.selector);
    const result = await this.page._evaluate(
      `(function() {
        const el = document.querySelector('${escapedSel}');
        if (!el) throw new Error('Element not found: ${escapedSel}');
        return el.value;
      })()`,
    );
    return String(result ?? "");
  }

  /**
   * Return the value of the given attribute on the element.
   * Returns null when the attribute is absent. Waits for the element to appear.
   * AC-1 (Issue #36)
   */
  async getAttribute(name: string, opts?: { timeout?: number }): Promise<string | null> {
    await this.page.waitForSelector(this.selector, opts);
    const escapedSel = escapeSelector(this.selector);
    const escapedName = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const result = await this.page._evaluate(
      `(function() {
        const el = document.querySelector('${escapedSel}');
        if (!el) return null;
        const val = el.getAttribute('${escapedName}');
        return val === undefined ? null : val;
      })()`,
    );
    if (result === null || result === undefined) return null;
    return String(result);
  }

  /**
   * Return the visible text (innerText) of the element.
   * Waits for the element to appear.
   * AC-2 (Issue #36)
   */
  async innerText(opts?: { timeout?: number }): Promise<string> {
    await this.page.waitForSelector(this.selector, opts);
    const escapedSel = escapeSelector(this.selector);
    const result = await this.page._evaluate(
      `(function() {
        const el = document.querySelector('${escapedSel}');
        if (!el) throw new Error('Element not found: ${escapedSel}');
        return el.innerText;
      })()`,
    );
    return String(result ?? "");
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
