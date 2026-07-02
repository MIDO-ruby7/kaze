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

import { Locator, ByTextLocator, ByRoleLocator, type GetByTextOptions, type AriaRole, type GetByRoleOptions } from "./Locator.js";
import { Route, type FulfillOptions } from "./Route.js";
import { escapeSelector } from "./utils.js";

/** Returns true when `err` is the "Element not found" error thrown by the adapter. */
function isElementNotFound(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("Element not found:");
}

export interface GotoOptions {
  /** Maximum navigation timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
  /**
   * When to consider the navigation as finished.
   * - 'load' (default): wait for the load event (already handled by adapter.navigate)
   * - 'domcontentloaded': wait until DOMContentLoaded fires
   * - 'networkidle': wait until there are no network requests for 500ms
   * - 'commit': resolve as soon as the initial HTML is received
   *
   * Use 'networkidle' for CSR frameworks (React, Vue, etc.) that render
   * asynchronously after the load event.
   */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
}

export interface WaitForSelectorOptions {
  /** Maximum wait time in milliseconds. Defaults to 30000. */
  timeout?: number;
}

export interface WaitForURLOptions {
  /** Maximum wait time in milliseconds. Defaults to 30000. */
  timeout?: number;
}

export interface WaitForLoadStateOptions {
  /** Maximum wait time in milliseconds. Defaults to 30000. */
  timeout?: number;
}

export type LoadState = "load" | "domcontentloaded" | "networkidle";

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

  /**
   * AC-1/AC-3/AC-11: Registered route handlers keyed by a normalized string key.
   * RegExp patterns are normalized via _routeKey() so that two RegExp instances
   * with the same source + flags compare equal (Map identity would fail otherwise).
   * Using Map to preserve insertion order.
   */
  private _routes = new Map<string, (route: Route) => void>();

  /** Parallel map from normalized key → original pattern, used for matchesPattern(). */
  private _routePatterns = new Map<string, string | RegExp>();

  /**
   * AC-1: Unsubscribe function returned by adapter.onRequest. Set once
   * interception is enabled, cleared when disabled.
   */
  private _unsubscribeRequest: (() => void) | null = null;

  constructor(
    private readonly adapter: ProtocolAdapter,
    private readonly ctx: PooledContext,
  ) {
    this.contextId = ctx.contextId;
    // AC-11: Register a cancellation hook on the context so that Scheduler can
    // stop polling after a test times out, without importing Page directly.
    ctx._cancel = () => this.cancel();
    // AC-14: Register a reset hook so that BrowserPool can clear Page-level
    // route state (handlers, subscriptions) before adapter.resetContext() is
    // called.  This keeps Page and adapter state in sync across context reuse.
    ctx._onReset = () => this.resetRoutes();
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
  async goto(url: string, opts?: GotoOptions): Promise<void> {
    await this.adapter.navigate(this.contextId, url);

    // CSR framework support: additional wait after the load event.
    // adapter.navigate already waits for loadEventFired; for React/Vue/etc.
    // the DOM continues rendering after load, so callers can opt in to a
    // stricter ready condition via waitUntil.
    if (opts?.waitUntil === 'networkidle') {
      await this.waitForLoadState('networkidle', { timeout: opts.timeout });
    } else if (opts?.waitUntil === 'domcontentloaded') {
      await this.waitForLoadState('domcontentloaded', { timeout: opts.timeout });
    }
    // 'load' and 'commit' are already satisfied by adapter.navigate completing.
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
        // Capture URL before click to detect SPA navigation after click
        const urlBefore = await this.adapter.evaluate(this.contextId, "location.href") as string;
        await this.adapter.dispatchEvent(this.contextId, selector, "click");

        // Check once after 150ms for SPA navigation.
        // Avoids the 2000ms polling loop for non-navigation clicks (e.g. input.click).
        await new Promise(r => setTimeout(r, 150));
        if (!this._cancelled) {
          const urlAfter = await this.adapter.evaluate(this.contextId, "location.href") as string;
          if (urlAfter !== urlBefore) {
            // SPA navigation detected — wait for DOM to stabilize
            await new Promise(r => setTimeout(r, 300));
          }
        }

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
    let executed = false;
    const escapedSel = escapeSelector(selector);
    const escapedVal = value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    while (Date.now() < deadline) {
      executed = true;
      const remaining = deadline - Date.now();
      await this.waitForSelector(selector, { timeout: remaining });
      try {
        await this.adapter.evaluate(
          this.contextId,
          `(function() {
            var el = document.querySelector('${escapedSel}');
            if (!el) throw new Error('Element not found: ${escapedSel}');
            el.focus();
            // Use native prototype setter to bypass React's controlled-input tracker.
            // React overrides the value setter on the element instance; going through
            // the prototype setter marks the tracker stale so React fires onChange.
            // For Vue and plain HTML the native setter is equivalent to direct assignment.
            var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            var setter = Object.getOwnPropertyDescriptor(proto, 'value');
            if (setter && setter.set) { setter.set.call(el, '${escapedVal}'); } else { el.value = '${escapedVal}'; }
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

  /**
   * Wait until the page URL matches the given pattern.
   * Accepts an exact string, a glob (** wildcard), or a RegExp.
   * AC-3 (Issue #36)
   */
  async waitForURL(url: string | RegExp, opts?: WaitForURLOptions): Promise<void> {
    const timeout = opts?.timeout ?? 30_000;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline && !this._cancelled) {
      const current = await this.adapter.evaluate(
        this.contextId,
        "window.location.href",
      ) as string;
      if (matchesUrlPattern(url, String(current))) return;
      await delay(100);
    }
    if (this._cancelled) {
      throw new Error(`URL wait cancelled`);
    }
    throw new Error(`Timeout ${timeout}ms waiting for URL ${url}`);
  }

  /**
   * Wait until the page reaches the given load state.
   *
   * - "load" / "domcontentloaded": polls `document.readyState`
   * - "networkidle": waits until there is no fetch/XHR activity for 500ms
   *
   * AC-4 (Issue #36)
   */
  async waitForLoadState(
    state: LoadState = "load",
    opts?: WaitForLoadStateOptions,
  ): Promise<void> {
    const timeout = opts?.timeout ?? 30_000;
    const deadline = Date.now() + timeout;

    if (state === "networkidle") {
      // Inject a counter that tracks in-flight fetch/XHR, then wait until it
      // has been at zero continuously for 500ms.
      await this.adapter.evaluate(
        this.contextId,
        `(function() {
          if (window.__kazeNetworkCount !== undefined) return;
          window.__kazeNetworkCount = 0;
          window.__kazeNetworkIdle = null;
          const origFetch = window.fetch;
          window.fetch = function() {
            window.__kazeNetworkCount++;
            window.__kazeNetworkIdle = null;
            const p = origFetch.apply(this, arguments);
            p.finally(function() {
              window.__kazeNetworkCount = Math.max(0, window.__kazeNetworkCount - 1);
            });
            return p;
          };
          const origXHROpen = XMLHttpRequest.prototype.open;
          const origXHRSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.send = function() {
            window.__kazeNetworkCount++;
            window.__kazeNetworkIdle = null;
            this.addEventListener('loadend', function() {
              window.__kazeNetworkCount = Math.max(0, window.__kazeNetworkCount - 1);
            });
            return origXHRSend.apply(this, arguments);
          };
        })()`,
      );

      let idleStart: number | null = null;
      while (Date.now() < deadline && !this._cancelled) {
        const count = await this.adapter.evaluate(
          this.contextId,
          "window.__kazeNetworkCount === undefined ? 0 : window.__kazeNetworkCount",
        ) as number;
        if (Number(count) === 0) {
          if (idleStart === null) idleStart = Date.now();
          if (Date.now() - idleStart >= 500) return;
        } else {
          idleStart = null;
        }
        await delay(50);
      }
      if (this._cancelled) throw new Error(`Load state wait cancelled`);
      throw new Error(`Timeout ${timeout}ms waiting for load state "${state}"`);
    }

    // load / domcontentloaded
    const readyStateTarget = state === "load" ? "complete" : "interactive";
    while (Date.now() < deadline && !this._cancelled) {
      const readyState = await this.adapter.evaluate(
        this.contextId,
        "document.readyState",
      ) as string;
      if (String(readyState) === "complete") return;
      if (readyStateTarget === "interactive" && (String(readyState) === "interactive" || String(readyState) === "complete")) return;
      await delay(100);
    }
    if (this._cancelled) throw new Error(`Load state wait cancelled`);
    throw new Error(`Timeout ${timeout}ms waiting for load state "${state}"`);
  }

  /**
   * Create a Locator for elements matching `selector` within this page.
   *
   * Supports Playwright's `:text("...")` pseudo-selector syntax as a shorthand
   * for getByText(). Both double-quoted and single-quoted forms are accepted.
   */
  locator(selector: string): Locator {
    // :text("...") or :text('...') → getByText(...)
    const textMatch =
      selector.match(/^:text\("(.+?)"\)$/) ||
      selector.match(/^:text\('(.+?)'\)$/);
    if (textMatch) return this.getByText(textMatch[1]!);
    return new Locator(this, selector);
  }

  /**
   * AC-1 (Issue #44): Return a Locator for the first element whose visible
   * text matches `text`.
   *
   * - Default (exact: false): partial match — element's trimmed textContent
   *   includes `text`.
   * - { exact: true }: element's trimmed textContent equals `text` exactly.
   *
   * Implementation uses an evaluate-based DOM scan that assigns a unique
   * `data-kaze-bytext-*` attribute so subsequent actions can target the
   * element precisely (same pattern as NthLocator).
   */
  getByText(text: string, opts?: GetByTextOptions): Locator {
    const exact = opts?.exact ?? false;
    const escapedText = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return new ByTextLocator(this, (tag: string) => {
      if (exact) {
        return `(function(){
          var els = document.querySelectorAll('*');
          for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (el.children.length === 0 && el.textContent.trim() === '${escapedText}') {
              el.setAttribute('${tag}', '1');
              break;
            }
          }
        })()`;
      }
      return `(function(){
        var els = document.querySelectorAll('*');
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          if (el.textContent.includes('${escapedText}') && el.children.length === 0) {
            el.setAttribute('${tag}', '1');
            break;
          }
        }
      })()`;
    });
  }

  /**
   * AC-2 (Issue #44): Return a Locator for the form control associated with
   * a label whose text matches `text`.
   *
   * Supports:
   * - `<label for="id">text</label><input id="id">` (for/id association)
   * - `<label>text<input></label>` (nesting)
   *
   * Default: partial text match. Pass `{ exact: true }` for exact match.
   */
  getByLabel(text: string, opts?: GetByTextOptions): Locator {
    const exact = opts?.exact ?? false;
    const escapedText = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return new ByTextLocator(this, (tag: string) => {
      const matchExpr = exact
        ? `lbl.textContent.trim() === '${escapedText}'`
        : `lbl.textContent.includes('${escapedText}')`;
      return `(function(){
        var labels = document.querySelectorAll('label');
        for (var i = 0; i < labels.length; i++) {
          var lbl = labels[i];
          if (${matchExpr}) {
            var ctrl = null;
            // for/id association
            if (lbl.htmlFor) {
              ctrl = document.getElementById(lbl.htmlFor);
            }
            // nested control
            if (!ctrl) {
              ctrl = lbl.querySelector('input,select,textarea');
            }
            if (ctrl) {
              ctrl.setAttribute('${tag}', '1');
              break;
            }
          }
        }
      })()`;
    });
  }

  /**
   * AC-3 (Issue #44): Return a Locator for an element whose placeholder
   * attribute matches `text`.
   *
   * Default: partial match (`[placeholder*="text"]`-style).
   * Pass `{ exact: true }` for exact match (`[placeholder="text"]`).
   */
  getByPlaceholder(text: string, opts?: GetByTextOptions): Locator {
    const exact = opts?.exact ?? false;
    const escapedText = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return new ByTextLocator(this, (tag: string) => {
      const matchExpr = exact
        ? `el.getAttribute('placeholder') === '${escapedText}'`
        : `(el.getAttribute('placeholder') || '').includes('${escapedText}')`;
      return `(function(){
        var els = document.querySelectorAll('[placeholder]');
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          if (${matchExpr}) {
            el.setAttribute('${tag}', '1');
            break;
          }
        }
      })()`;
    });
  }

  /**
   * AC-4 (Issue #44): Return a Locator for `[data-testid="id"]`.
   *
   * This is a simple CSS selector locator — no lazy evaluation needed.
   */
  getByTestId(id: string): Locator {
    return new Locator(this, `[data-testid="${id}"]`);
  }

  /**
   * AC-1 (Issue #47): Return a Locator for elements matching the given ARIA role.
   *
   * Supports all WAI-ARIA 1.2 roles (AC-2). Implicit HTML roles are mapped to
   * their natural CSS selectors (e.g. "button" → `button, [role="button"], ...`).
   * Unknown roles fall back to `[role="${role}"]`.
   *
   * Options:
   * - `{ name }` — filter by accessible name (aria-label → aria-labelledby →
   *   textContent). Accepts string or RegExp. (AC-3)
   * - `{ exact }` — when true, name must match exactly (case-sensitive).
   *   Default: false (partial match). (AC-4)
   */
  getByRole(role: AriaRole, opts?: GetByRoleOptions): Locator {
    return new ByRoleLocator(this, role, opts);
  }

  /**
   * Return the page title (document.title).
   * AC-2 (Issue #31)
   */
  async title(): Promise<string> {
    const result = await this.adapter.evaluate(this.contextId, "document.title");
    return String(result ?? "");
  }

  /**
   * Keyboard interaction API.
   * AC-2 (Issue #31)
   */
  readonly keyboard = {
    /**
     * Dispatch keydown and keyup events for the given key.
     * @param key Key name, e.g. "Enter", "Tab", "Escape".
     */
    press: async (key: string): Promise<void> => {
      const escapedKey = key.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      await this.adapter.evaluate(
        this.contextId,
        `(function() {
          const KEY_MAP = {
            Enter:     { kc: 13,  code: 'Enter' },
            Tab:       { kc: 9,   code: 'Tab' },
            Escape:    { kc: 27,  code: 'Escape' },
            Backspace: { kc: 8,   code: 'Backspace' },
            Delete:    { kc: 46,  code: 'Delete' },
            Space:     { kc: 32,  code: 'Space' },
            ArrowUp:   { kc: 38,  code: 'ArrowUp' },
            ArrowDown: { kc: 40,  code: 'ArrowDown' },
            ArrowLeft: { kc: 37,  code: 'ArrowLeft' },
            ArrowRight:{ kc: 39,  code: 'ArrowRight' },
            Home:      { kc: 36,  code: 'Home' },
            End:       { kc: 35,  code: 'End' },
            PageUp:    { kc: 33,  code: 'PageUp' },
            PageDown:  { kc: 34,  code: 'PageDown' },
            F1:        { kc: 112, code: 'F1' },
            F2:        { kc: 113, code: 'F2' },
          };
          const entry = KEY_MAP['${escapedKey}'];
          const keyCode = entry ? entry.kc : ('${escapedKey}'.length === 1 ? '${escapedKey}'.charCodeAt(0) : 0);
          const code    = entry ? entry.code : ('${escapedKey}'.length === 1 ? 'Key' + '${escapedKey}'.toUpperCase() : '${escapedKey}');
          const opts = { key: '${escapedKey}', code, keyCode, which: keyCode, charCode: keyCode, bubbles: true, cancelable: true };
          const target = document.activeElement || document.body;
          target.dispatchEvent(new KeyboardEvent('keydown', opts));
          target.dispatchEvent(new KeyboardEvent('keypress', opts));
          target.dispatchEvent(new KeyboardEvent('keyup', opts));
        })()`,
      );
    },
  };

  /**
   * Capture a screenshot of the page.
   * Returns PNG bytes as a Buffer.
   * AC-2 (Issue #31)
   */
  async screenshot(_opts?: { path?: string }): Promise<Buffer> {
    if (this.adapter.screenshot) {
      return this.adapter.screenshot(this.contextId);
    }
    // Fallback: evaluate to get pixel data when adapter.screenshot is absent.
    // This returns an empty PNG-like buffer for testing purposes.
    const result = await this.adapter.evaluate(
      this.contextId,
      `(function() {
        try {
          const c = document.createElement('canvas');
          c.width = window.innerWidth || 800;
          c.height = window.innerHeight || 600;
          const ctx = c.getContext('2d');
          if (ctx) ctx.drawImage(document.documentElement, 0, 0);
          return Array.from(atob(c.toDataURL('image/png').split(',')[1])).map(ch => ch.charCodeAt(0));
        } catch {
          return [];
        }
      })()`,
    );
    const bytes = Array.isArray(result) ? (result as number[]) : [];
    return Buffer.from(bytes);
  }

  /**
   * Evaluate a JavaScript expression or function in the browser context.
   * Playwright-compatible: page.evaluate(fn, ...args)
   */
  async evaluate<T = unknown>(
    fnOrExpr: string | ((...args: unknown[]) => unknown),
    ...args: unknown[]
  ): Promise<T> {
    const expr =
      typeof fnOrExpr === "function"
        ? `(${fnOrExpr.toString()})(${args.map((a) => JSON.stringify(a)).join(",")})`
        : String(fnOrExpr);
    return this.adapter.evaluate(this.contextId, expr) as Promise<T>;
  }

  /**
   * Internal: dispatch a DOM event on the element matching selector.
   * Used by Locator.hover() and similar methods.
   * @internal
   */
  async _dispatchEvent(selector: string, event: string): Promise<void> {
    await this.adapter.dispatchEvent(this.contextId, selector, event);
  }

  /**
   * AC-11: Normalize a route pattern to a stable string key.
   * Two RegExp instances with the same source + flags produce the same key.
   */
  private _routeKey(pattern: string | RegExp): string {
    if (typeof pattern === "string") return pattern;
    return `__regexp__${pattern.source}__${pattern.flags}`;
  }

  /**
   * AC-1: Intercept requests matching `pattern` with `handler`.
   * Pattern can be a string (exact match or glob with **) or RegExp.
   */
  async route(pattern: string | RegExp, handler: (route: Route) => void): Promise<void> {
    const wasEmpty = this._routes.size === 0;
    const key = this._routeKey(pattern);
    this._routes.set(key, handler);
    this._routePatterns.set(key, pattern);

    if (wasEmpty) {
      // Enable interception on first route registration
      await this.adapter.enableRequestInterception?.(this.contextId);

      // Register a single listener that dispatches to matching handlers
      if (this.adapter.onRequest) {
        this._unsubscribeRequest = this.adapter.onRequest(
          this.contextId,
          (req) => this._handleInterceptedRequest(req),
        );
      }
    }
  }

  /**
   * AC-3: Remove the interceptor for `pattern`.
   * If no routes remain, disables interception.
   */
  async unroute(pattern: string | RegExp): Promise<void> {
    const key = this._routeKey(pattern);
    this._routes.delete(key);
    this._routePatterns.delete(key);

    if (this._routes.size === 0) {
      await this._disableInterception();
    }
  }

  /**
   * AC-4: Called by context reset logic to clear all routes and disable interception.
   */
  async resetRoutes(): Promise<void> {
    this._routes.clear();
    this._routePatterns.clear();
    await this._disableInterception();
  }

  private async _disableInterception(): Promise<void> {
    if (this._unsubscribeRequest) {
      this._unsubscribeRequest();
      this._unsubscribeRequest = null;
    }
    await this.adapter.disableRequestInterception?.(this.contextId);
  }

  private _handleInterceptedRequest(req: { requestId: string; url: string }): void {
    const match = this._findMatchingRoute(req.url);
    if (!match) {
      // No handler — continue the request
      void this.adapter.continueRequest?.(this.contextId, req.requestId);
      return;
    }

    const route = new Route(
      req.requestId,
      (opts: FulfillOptions) =>
        this.adapter.fulfillRequest
          ? this.adapter.fulfillRequest(this.contextId, req.requestId, opts)
          : Promise.resolve(),
      () =>
        this.adapter.continueRequest
          ? this.adapter.continueRequest(this.contextId, req.requestId)
          : Promise.resolve(),
      () =>
        this.adapter.abortRequest
          ? this.adapter.abortRequest(this.contextId, req.requestId)
          : Promise.resolve(),
    );

    // AC-8: Wrap in Promise so async handler rejections don't become unhandled
    // Promise rejections. After the handler resolves/rejects, fall back to
    // continue() if the handler never called fulfill/continue/abort.
    Promise.resolve(match(route)).catch(() => {
      // handler threw — fall through to the fallback below
    }).finally(() => {
      if (!route._handled) {
        void this.adapter.continueRequest?.(this.contextId, req.requestId);
      }
    });
  }

  /**
   * Find the first handler whose pattern matches `url`.
   * Patterns are checked in insertion order.
   */
  private _findMatchingRoute(url: string): ((route: Route) => void) | undefined {
    for (const [key, handler] of this._routes) {
      const pattern = this._routePatterns.get(key)!;
      if (matchesPattern(pattern, url)) {
        return handler;
      }
    }
    return undefined;
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
 * AC-3 (Issue #36): Match a URL against a string (exact, glob, or RegExp) for waitForURL.
 */
function matchesUrlPattern(pattern: string | RegExp, url: string): boolean {
  return matchesPattern(pattern, url);
}

/**
 * AC-1 / AC-8: Match a URL against a string (exact or glob with *, **, ?) or RegExp pattern.
 *
 * Matching strategy for string patterns:
 * - RegExp: used as-is.
 * - String containing `*` or `?`: interpreted as a glob.
 *   `**` → `.*`, `*` → `[^/]*`, `?` → `[^/]`
 * - String without glob characters: exact match (all regex special chars including `?`
 *   and `.` are escaped so they match literally).
 */
function matchesPattern(pattern: string | RegExp, url: string): boolean {
  if (pattern instanceof RegExp) {
    return pattern.test(url);
  }
  const isGlob = /[*?]/.test(pattern);
  if (isGlob) {
    // Glob: escape regex special chars except * and ?, then expand glob syntax
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex special chars (excluding * and ?)
      .replace(/\*\*/g, "\x00")              // placeholder for **
      .replace(/\*/g, "[^/]*")               // single * → [^/]*
      .replace(/\x00/g, ".*")               // ** → .*
      .replace(/\?/g, "[^/]");              // ? → single non-slash char (glob)
    return new RegExp(`^${regexStr}$`).test(url);
  }
  // Exact match: escape all regex special chars including ? and .
  const escaped = pattern.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}$`).test(url);
}

/**
 * Create a Page from a PooledContext.
 * The caller is responsible for supplying the adapter that owns this context.
 */
export function createPage(adapter: ProtocolAdapter, ctx: PooledContext): Page {
  return new Page(adapter, ctx);
}
