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
 * AriaRole — ARIA role values supported by getByRole().
 * Covers all WAI-ARIA 1.2 roles (abstract roles excluded).
 */
export type AriaRole =
  | "alert"
  | "alertdialog"
  | "application"
  | "article"
  | "banner"
  | "blockquote"
  | "button"
  | "caption"
  | "cell"
  | "checkbox"
  | "code"
  | "columnheader"
  | "combobox"
  | "complementary"
  | "contentinfo"
  | "definition"
  | "deletion"
  | "dialog"
  | "document"
  | "emphasis"
  | "feed"
  | "figure"
  | "form"
  | "generic"
  | "grid"
  | "gridcell"
  | "group"
  | "heading"
  | "img"
  | "insertion"
  | "link"
  | "list"
  | "listbox"
  | "listitem"
  | "log"
  | "main"
  | "mark"
  | "marquee"
  | "math"
  | "meter"
  | "menu"
  | "menubar"
  | "menuitem"
  | "menuitemcheckbox"
  | "menuitemradio"
  | "navigation"
  | "none"
  | "note"
  | "option"
  | "paragraph"
  | "presentation"
  | "progressbar"
  | "radio"
  | "radiogroup"
  | "region"
  | "row"
  | "rowgroup"
  | "rowheader"
  | "scrollbar"
  | "search"
  | "searchbox"
  | "separator"
  | "slider"
  | "spinbutton"
  | "status"
  | "strong"
  | "subscript"
  | "superscript"
  | "switch"
  | "tab"
  | "table"
  | "tablist"
  | "tabpanel"
  | "term"
  | "textbox"
  | "time"
  | "timer"
  | "toolbar"
  | "tooltip"
  | "tree"
  | "treegrid"
  | "treeitem";

/**
 * GetByRoleOptions — options for getByRole().
 */
export interface GetByRoleOptions {
  /** Filter by accessible name (aria-label, aria-labelledby, or textContent). */
  name?: string | RegExp;
  /** When true, name must match exactly. Default: false (partial match). */
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
    // AC-4: use the raw selector without escapeSelector so comma-separated
    // selectors are passed directly to querySelectorAll without modification.
    const rawSel = this._parentSelector.replace(/'/g, "\\'");
    const idx = this._index;
    // AC-3: append a random suffix to guarantee uniqueness across concurrent calls.
    const tag = `data-kaze-nth-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await (this.page as any)._evaluate(
      `(function(){
        const els = document.querySelectorAll('${rawSel}');
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

/**
 * ByRoleLocator — a Locator that resolves by ARIA role at action time.
 *
 * Implements AC-1..AC-4 of Issue #47: page.getByRole(role, opts?).
 *
 * Resolution strategy (mirrors ByTextLocator):
 * 1. Build a CSS selector from the role using implicit HTML role mappings.
 * 2. Iterate matching elements; filter by accessible name when opts.name
 *    is provided (aria-label → aria-labelledby → textContent order).
 * 3. Tag the first matching element with a unique data-kaze-role-* attribute
 *    so that subsequent Locator actions can address it precisely.
 */
export class ByRoleLocator extends Locator {
  constructor(
    page: Page,
    private readonly _role: AriaRole,
    private readonly _opts?: GetByRoleOptions,
  ) {
    super(page, "");
  }

  /** Tag the matching element and return the unique attribute selector. */
  private async _resolve(): Promise<string> {
    const tag = `data-kaze-role-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const script = buildByRoleScript(this._role, this._opts, tag);
    await (this.page as Page)._evaluate(script);
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
    const result = await (this.page as any)._evaluate(
      buildByRoleCountScript(this._role, this._opts)
    );
    return Number(result ?? 0);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers for ByRoleLocator
// ---------------------------------------------------------------------------

/**
 * Map an ARIA role to a CSS selector that matches elements with that implicit
 * or explicit role.  Falls back to `[role="${role}"]` for roles without a
 * well-known HTML mapping.
 */
function roleToSelector(role: AriaRole): string {
  switch (role) {
    case "button":
      return 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]';
    case "link":
      return 'a[href], [role="link"]';
    case "textbox":
      return 'input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="search"], input[type="password"], textarea, [role="textbox"]';
    case "checkbox":
      return 'input[type="checkbox"], [role="checkbox"]';
    case "radio":
      return 'input[type="radio"], [role="radio"]';
    case "combobox":
      return 'select, [role="combobox"]';
    case "listbox":
      return 'select[multiple], [role="listbox"]';
    case "option":
      return 'option, [role="option"]';
    case "menuitem":
      return '[role="menuitem"]';
    case "menuitemcheckbox":
      return '[role="menuitemcheckbox"]';
    case "menuitemradio":
      return '[role="menuitemradio"]';
    case "tab":
      return '[role="tab"]';
    case "tabpanel":
      return '[role="tabpanel"]';
    case "tablist":
      return '[role="tablist"]';
    case "heading":
      return 'h1, h2, h3, h4, h5, h6, [role="heading"]';
    case "img":
      return 'img, [role="img"]';
    case "list":
      return 'ul, ol, [role="list"]';
    case "listitem":
      return 'li, [role="listitem"]';
    case "table":
      return 'table, [role="table"]';
    case "row":
      return 'tr, [role="row"]';
    case "cell":
      return 'td, [role="cell"]';
    case "columnheader":
      return 'th[scope="col"], th:not([scope]), [role="columnheader"]';
    case "rowheader":
      return 'th[scope="row"], [role="rowheader"]';
    case "grid":
      return '[role="grid"]';
    case "gridcell":
      return '[role="gridcell"]';
    case "dialog":
      return 'dialog, [role="dialog"]';
    case "alertdialog":
      return '[role="alertdialog"]';
    case "alert":
      return '[role="alert"]';
    case "status":
      return '[role="status"]';
    case "log":
      return '[role="log"]';
    case "progressbar":
      return 'progress, [role="progressbar"]';
    case "slider":
      return 'input[type="range"], [role="slider"]';
    case "spinbutton":
      return 'input[type="number"], [role="spinbutton"]';
    case "searchbox":
      return 'input[type="search"], [role="searchbox"]';
    case "separator":
      return 'hr, [role="separator"]';
    case "scrollbar":
      return '[role="scrollbar"]';
    case "form":
      return 'form, [role="form"]';
    case "search":
      return '[role="search"]';
    case "navigation":
      return 'nav, [role="navigation"]';
    case "main":
      return 'main, [role="main"]';
    case "banner":
      return 'header, [role="banner"]';
    case "contentinfo":
      return 'footer, [role="contentinfo"]';
    case "complementary":
      return 'aside, [role="complementary"]';
    case "region":
      return 'section, [role="region"]';
    case "article":
      return 'article, [role="article"]';
    case "figure":
      return 'figure, [role="figure"]';
    case "group":
      return 'fieldset, optgroup, [role="group"]';
    case "radiogroup":
      return '[role="radiogroup"]';
    case "menu":
      return '[role="menu"]';
    case "menubar":
      return '[role="menubar"]';
    case "tree":
      return '[role="tree"]';
    case "treeitem":
      return '[role="treeitem"]';
    case "treegrid":
      return '[role="treegrid"]';
    case "toolbar":
      return '[role="toolbar"]';
    case "tooltip":
      return '[role="tooltip"]';
    case "feed":
      return '[role="feed"]';
    case "switch":
      return '[role="switch"]';
    case "math":
      return 'math, [role="math"]';
    case "meter":
      return 'meter, [role="meter"]';
    case "timer":
      return '[role="timer"]';
    case "marquee":
      return '[role="marquee"]';
    case "application":
      return '[role="application"]';
    case "document":
      return '[role="document"]';
    case "note":
      return '[role="note"]';
    case "term":
      return 'dfn, [role="term"]';
    case "definition":
      return '[role="definition"]';
    case "paragraph":
      return 'p, [role="paragraph"]';
    case "blockquote":
      return 'blockquote, [role="blockquote"]';
    case "caption":
      return 'caption, [role="caption"]';
    case "code":
      return 'code, [role="code"]';
    case "deletion":
      return 'del, [role="deletion"]';
    case "emphasis":
      return 'em, [role="emphasis"]';
    case "insertion":
      return 'ins, [role="insertion"]';
    case "strong":
      return 'strong, [role="strong"]';
    case "subscript":
      return 'sub, [role="subscript"]';
    case "superscript":
      return 'sup, [role="superscript"]';
    case "time":
      return 'time, [role="time"]';
    case "mark":
      return 'mark, [role="mark"]';
    case "generic":
      return '[role="generic"]';
    case "none":
    case "presentation":
      return '[role="none"], [role="presentation"]';
    case "rowgroup":
      return 'thead, tbody, tfoot, [role="rowgroup"]';
    default:
      return `[role="${role}"]`;
  }
}

/**
 * Build the evaluate script that finds an element by role + optional name,
 * tags it with `tag`, and returns nothing.
 *
 * Name resolution order (mirrors ARIA spec):
 *   1. aria-label attribute
 *   2. aria-labelledby → referenced element's textContent
 *   3. element's own textContent
 */
function buildByRoleScript(role: AriaRole, opts: GetByRoleOptions | undefined, tag: string): string {
  const cssSel = roleToSelector(role).replace(/'/g, "\\'");

  if (!opts?.name) {
    // No name filter — tag the first element matching the role selector.
    return `(function(){
      var els = document.querySelectorAll('${cssSel}');
      if (els.length > 0) els[0].setAttribute('${tag}', '1');
    })()`;
  }

  const exact = opts.exact ?? false;

  // Serialize the name matcher into the script.
  // name can be a string or RegExp; we handle both via inline JS.
  let nameMatcher: string;
  if (opts.name instanceof RegExp) {
    nameMatcher = `/${opts.name.source}/${opts.name.flags}`;
  } else {
    const escapedName = opts.name
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
    nameMatcher = `'${escapedName}'`;
  }

  const isRegExp = opts.name instanceof RegExp;

  if (isRegExp) {
    return `(function(){
      var pattern = ${nameMatcher};
      var els = document.querySelectorAll('${cssSel}');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var accName = el.getAttribute('aria-label') || '';
        if (!accName && el.getAttribute('aria-labelledby')) {
          var ref = document.getElementById(el.getAttribute('aria-labelledby'));
          if (ref) accName = ref.textContent || '';
        }
        if (!accName) accName = el.textContent || '';
        accName = accName.trim();
        if (pattern.test(accName)) {
          el.setAttribute('${tag}', '1');
          break;
        }
      }
    })()`;
  }

  if (exact) {
    return `(function(){
      var name = ${nameMatcher};
      var els = document.querySelectorAll('${cssSel}');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var accName = el.getAttribute('aria-label') || '';
        if (!accName && el.getAttribute('aria-labelledby')) {
          var ref = document.getElementById(el.getAttribute('aria-labelledby'));
          if (ref) accName = ref.textContent || '';
        }
        if (!accName) accName = el.textContent || '';
        accName = accName.trim();
        if (accName === name) {
          el.setAttribute('${tag}', '1');
          break;
        }
      }
    })()`;
  }

  return `(function(){
    var name = ${nameMatcher};
    var els = document.querySelectorAll('${cssSel}');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var accName = el.getAttribute('aria-label') || '';
      if (!accName && el.getAttribute('aria-labelledby')) {
        var ref = document.getElementById(el.getAttribute('aria-labelledby'));
        if (ref) accName = ref.textContent || '';
      }
      if (!accName) accName = el.textContent || '';
      accName = accName.trim();
      if (accName.toLowerCase().indexOf(name.toLowerCase()) !== -1) {
        el.setAttribute('${tag}', '1');
        break;
      }
    }
  })()`;
}

/**
 * Build the evaluate script that counts elements matching the given role +
 * optional name filter.  Returns the count as a number.
 */
function buildByRoleCountScript(role: AriaRole, opts: GetByRoleOptions | undefined): string {
  const cssSel = roleToSelector(role).replace(/'/g, "\\'");

  if (!opts?.name) {
    return `(function(){
      return document.querySelectorAll('${cssSel}').length;
    })()`;
  }

  const exact = opts.exact ?? false;

  if (opts.name instanceof RegExp) {
    const nameMatcher = `/${opts.name.source}/${opts.name.flags}`;
    return `(function(){
      var pattern = ${nameMatcher};
      var els = document.querySelectorAll('${cssSel}');
      var count = 0;
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var accName = el.getAttribute('aria-label') || '';
        if (!accName && el.getAttribute('aria-labelledby')) {
          var ref = document.getElementById(el.getAttribute('aria-labelledby'));
          if (ref) accName = ref.textContent || '';
        }
        if (!accName) accName = el.textContent || '';
        accName = accName.trim();
        if (pattern.test(accName)) count++;
      }
      return count;
    })()`;
  }

  const escapedName = (opts.name as string)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  const nameMatcher = `'${escapedName}'`;

  if (exact) {
    return `(function(){
      var name = ${nameMatcher};
      var els = document.querySelectorAll('${cssSel}');
      var count = 0;
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var accName = el.getAttribute('aria-label') || '';
        if (!accName && el.getAttribute('aria-labelledby')) {
          var ref = document.getElementById(el.getAttribute('aria-labelledby'));
          if (ref) accName = ref.textContent || '';
        }
        if (!accName) accName = el.textContent || '';
        accName = accName.trim();
        if (accName === name) count++;
      }
      return count;
    })()`;
  }

  return `(function(){
    var name = ${nameMatcher};
    var els = document.querySelectorAll('${cssSel}');
    var count = 0;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var accName = el.getAttribute('aria-label') || '';
      if (!accName && el.getAttribute('aria-labelledby')) {
        var ref = document.getElementById(el.getAttribute('aria-labelledby'));
        if (ref) accName = ref.textContent || '';
      }
      if (!accName) accName = el.textContent || '';
      accName = accName.trim();
      if (accName.toLowerCase().indexOf(name.toLowerCase()) !== -1) count++;
    }
    return count;
  })()`;
}
