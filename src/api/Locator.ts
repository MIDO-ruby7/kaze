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
    protected readonly page: Page,
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
   * Returns a Locator for the first matching element.
   * Playwright-compatible: locator.first()
   * Uses a unique marker attribute assigned at action time.
   */
  first(): NthLocator {
    return new NthLocator(this.page, this.selector, 0);
  }

  /**
   * Returns a Locator for the last matching element.
   * Playwright-compatible: locator.last()
   */
  last(): NthLocator {
    return new NthLocator(this.page, this.selector, -1);
  }

  /**
   * Returns a Locator for the nth matching element (0-indexed).
   * Playwright-compatible: locator.nth(n)
   */
  nth(index: number): NthLocator {
    return new NthLocator(this.page, this.selector, index);
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

/**
 * GetByTextOptions — options for getByText / getByLabel / getByPlaceholder.
 */
export interface GetByTextOptions {
  /** When true, the text must match exactly (case-sensitive, no trimming). Default: false (partial match). */
  exact?: boolean;
}

/**
 * ByTextLocator — a Locator that resolves by tagging a matching element at
 * action time, using an evaluate-based DOM scan.
 *
 * This mirrors the NthLocator pattern: the actual CSS selector is unknown until
 * the action is about to be performed. Before each action, a unique attribute
 * (e.g. `data-kaze-bytext-<timestamp>`) is assigned to the first matching
 * element so that the base Locator methods can address it precisely.
 */
export class ByTextLocator extends Locator {
  constructor(
    page: Page,
    private readonly _script: (tag: string) => string,
  ) {
    // The real selector is not known yet; use an empty placeholder.
    super(page, "");
  }

  /** Tag the matching element and return the attribute selector for it. */
  private async _resolve(): Promise<string> {
    const tag = `data-kaze-bytext-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await (this.page as Page)._evaluate(this._script(tag));
    return `[${tag}]`;
  }

  private async _withResolved<T>(fn: (loc: Locator) => Promise<T>): Promise<T> {
    const sel = await this._resolve();
    return fn(new Locator(this.page as Page, sel));
  }

  async click(opts?: Parameters<Locator["click"]>[0]): Promise<void> {
    return this._withResolved(l => l.click(opts));
  }
  async fill(value: string, opts?: Parameters<Locator["fill"]>[1]): Promise<void> {
    return this._withResolved(l => l.fill(value, opts));
  }
  async textContent(opts?: Parameters<Locator["textContent"]>[0]): Promise<string | null> {
    return this._withResolved(l => l.textContent(opts));
  }
  async innerText(opts?: Parameters<Locator["innerText"]>[0]): Promise<string> {
    return this._withResolved(l => l.innerText(opts));
  }
  async getAttribute(name: string, opts?: Parameters<Locator["getAttribute"]>[1]): Promise<string | null> {
    return this._withResolved(l => l.getAttribute(name, opts));
  }
  async inputValue(opts?: Parameters<Locator["inputValue"]>[0]): Promise<string> {
    return this._withResolved(l => l.inputValue(opts));
  }
  async isVisible(): Promise<boolean> {
    return this._withResolved(l => l.isVisible());
  }
  async isEnabled(): Promise<boolean> {
    return this._withResolved(l => l.isEnabled());
  }
  async hover(opts?: Parameters<Locator["hover"]>[0]): Promise<void> {
    return this._withResolved(l => l.hover(opts));
  }
  async check(opts?: Parameters<Locator["check"]>[0]): Promise<void> {
    return this._withResolved(l => l.check(opts));
  }
  async uncheck(opts?: Parameters<Locator["uncheck"]>[0]): Promise<void> {
    return this._withResolved(l => l.uncheck(opts));
  }
  async selectOption(
    value: Parameters<Locator["selectOption"]>[0],
    opts?: Parameters<Locator["selectOption"]>[1],
  ): Promise<void> {
    return this._withResolved(l => l.selectOption(value, opts));
  }
  async count(): Promise<number> {
    const sel = await this._resolve();
    return new Locator(this.page as Page, sel).count();
  }
}

/**
 * NthLocator — a Locator that targets the nth element matching a selector.
 * Before each action, it evaluates querySelectorAll(selector)[index] in the
 * browser and assigns a unique `data-kaze-nth` attribute so the base Locator
 * methods can target it via a precise attribute selector.
 *
 * index = 0  → first(), index = -1 → last()
 */
export class NthLocator extends Locator {
  private readonly _parentSelector: string;
  private readonly _index: number;

  constructor(page: Page, parentSelector: string, index: number) {
    // Temporary selector — replaced at action time via _resolveNth()
    super(page, parentSelector);
    this._parentSelector = parentSelector;
    this._index = index;
  }

  /** Tag the nth element and return the attribute selector for it. */
  private async _resolveNth(): Promise<string> {
    const esc = escapeSelector(this._parentSelector);
    const idx = this._index;
    const tag = `data-kaze-nth-${Date.now()}`;
    await (this.page as any)._evaluate(
      `(function(){
        const els = document.querySelectorAll('${esc}');
        const el = ${idx} >= 0 ? els[${idx}] : els[els.length + ${idx}];
        if (el) el.setAttribute('${tag}', '1');
      })()`,
    );
    return `[${tag}]`;
  }

  private async _withResolved<T>(fn: (loc: Locator) => Promise<T>): Promise<T> {
    const sel = await this._resolveNth();
    return fn(new Locator(this.page as Page, sel));
  }

  async click(opts?: Parameters<Locator["click"]>[0]): Promise<void> {
    return this._withResolved(l => l.click(opts));
  }
  async fill(value: string, opts?: Parameters<Locator["fill"]>[1]): Promise<void> {
    return this._withResolved(l => l.fill(value, opts));
  }
  async textContent(opts?: Parameters<Locator["textContent"]>[0]): Promise<string | null> {
    return this._withResolved(l => l.textContent(opts));
  }
  async innerText(opts?: Parameters<Locator["innerText"]>[0]): Promise<string> {
    return this._withResolved(l => l.innerText(opts));
  }
  async getAttribute(name: string, opts?: Parameters<Locator["getAttribute"]>[1]): Promise<string | null> {
    return this._withResolved(l => l.getAttribute(name, opts));
  }
  async inputValue(opts?: Parameters<Locator["inputValue"]>[0]): Promise<string> {
    return this._withResolved(l => l.inputValue(opts));
  }
  async isVisible(): Promise<boolean> {
    return this._withResolved(l => l.isVisible());
  }
  async isEnabled(): Promise<boolean> {
    return this._withResolved(l => l.isEnabled());
  }
  async hover(opts?: Parameters<Locator["hover"]>[0]): Promise<void> {
    return this._withResolved(l => l.hover(opts));
  }
  async count(): Promise<number> {
    // nth locator always refers to 0 or 1 element
    const sel = await this._resolveNth();
    return new Locator(this.page as Page, sel).count();
  }
}
