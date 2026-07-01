/**
 * compat/shim.mjs — Playwright → kaze compatibility shim
 *
 * Allows Playwright-style test files (`async ({ page }) => {}`) to run on kaze
 * with minimal changes.
 *
 * Supported:
 *   - async ({ page }) => {} destructuring → async (page) => {} conversion
 *   - baseURL via KAZE_BASE_URL env var
 *   - page.evaluate()
 *   - page.url() synchronous return
 *   - page.screenshot({ path }) saving to disk
 *   - expect() extensions: toContainText, toBeGreaterThan, toBeTruthy, primitive values
 */

import { test as kazeTest, expect as kazeExpect } from "../dist/index.js"

const BASE_URL = process.env.KAZE_BASE_URL ?? process.env.BASE_URL ?? ""

// ---------------------------------------------------------------------------
// Page patching
// ---------------------------------------------------------------------------

function patchPage(page) {
  // baseURL + url() support
  {
    const origGoto = page.goto.bind(page)
    const origClick = page.click.bind(page)
    let _currentUrl = BASE_URL || ""

    // goto with baseURL prefix
    page.goto = async (url, opts) => {
      _currentUrl = (BASE_URL && !url.startsWith("http")) ? BASE_URL + url : url
      const result = await origGoto(_currentUrl, opts)
      // Refresh cached URL after navigation
      try { _currentUrl = await (Object.getPrototypeOf(page).url?.call(page) ?? _currentUrl) } catch {}
      return result
    }

    // After click, update cached URL (handles SPA navigation)
    page.click = async (selector, opts) => {
      await origClick(selector, opts)
      // Short delay for SPA navigation then refresh URL
      await new Promise(r => setTimeout(r, 300))
      try { _currentUrl = await (Object.getPrototypeOf(page).url?.call(page) ?? _currentUrl) } catch {}
    }

    // page.url() — Playwright-compatible synchronous return
    // Also works with await (returns same string)
    page.url = () => _currentUrl

    // Async refresh on demand (for toHaveURL polling)
    page._refreshUrl = async () => {
      try { _currentUrl = await (Object.getPrototypeOf(page).url?.call(page) ?? _currentUrl) } catch {}
      return _currentUrl
    }
  }

  // screenshot({ path }) — save buffer to disk
  const origScreenshot = page.screenshot.bind(page)
  page.screenshot = async (opts) => {
    const buf = await origScreenshot()
    if (opts?.path && buf) {
      const { writeFileSync, mkdirSync } = await import("node:fs")
      const { dirname } = await import("node:path")
      mkdirSync(dirname(opts.path), { recursive: true })
      writeFileSync(opts.path, buf)
      console.log(`  screenshot saved: ${opts.path}`)
    }
    return buf
  }

  return page
}

// ---------------------------------------------------------------------------
// Universal expect
// ---------------------------------------------------------------------------

/**
 * expect() that handles both Locator objects and primitive values.
 *
 * For primitives (string, number, boolean, null, undefined):
 *   Returns synchronous Jest-style matchers.
 *
 * For Locator objects:
 *   Delegates to kaze's kazeExpect and adds missing matchers.
 */
export const expect = (target) => {
  // Primitive path
  if (target === null || target === undefined || typeof target !== "object") {
    const fail = (msg) => { throw new Error(msg) }
    return {
      toEqual: (expected) => {
        if (target !== expected)
          fail(`Expected ${JSON.stringify(target)} to equal ${JSON.stringify(expected)}`)
      },
      toContain: (expected) => {
        if (!String(target).includes(String(expected)))
          fail(`Expected "${target}" to contain "${expected}"`)
      },
      toContainText: (expected) => {
        if (!String(target).includes(String(expected)))
          fail(`Expected "${target}" to containText "${expected}"`)
      },
      toBeGreaterThan: (n) => {
        if (!(Number(target) > n))
          fail(`Expected ${target} to be greater than ${n}`)
      },
      toBeTruthy: () => {
        if (!target) fail(`Expected ${target} to be truthy`)
      },
      toBeFalsy: () => {
        if (target) fail(`Expected ${target} to be falsy`)
      },
      toBeNull: () => {
        if (target !== null) fail(`Expected ${target} to be null`)
      },
      not: {
        toBeNull: () => { if (target === null) fail("Expected not null") },
        toBeTruthy: () => { if (target) fail(`Expected ${target} not to be truthy`) },
        toEqual: (expected) => {
          if (target === expected)
            fail(`Expected ${JSON.stringify(target)} not to equal ${JSON.stringify(expected)}`)
        },
      },
    }
  }

  // Locator path — delegate to kaze + augment
  const base = kazeExpect(target)

  // toContainText — polling partial text match (Playwright semantics)
  base.toContainText = async (expected, opts) => {
    const timeout = opts?.timeout ?? 15000
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      try {
        const text = await target.textContent()
        if (String(text ?? "").includes(String(expected))) return
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 100))
    }
    const actual = await target.textContent().catch(() => "")
    throw new Error(`Expected element to contain text "${expected}" but got "${actual}"`)
  }

  // toBeGreaterThan for numeric content
  base.toBeGreaterThan = async (n, opts) => {
    const timeout = opts?.timeout ?? 5000
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      try {
        const text = await target.textContent()
        const num = Number(text)
        if (num > n) return
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 100))
    }
    const actual = await target.textContent().catch(() => "")
    throw new Error(`Expected element text "${actual}" to be greater than ${n}`)
  }

  // toBeTruthy for existence checks
  base.toBeTruthy = async () => {
    const exists = (typeof target.count === "function") ? await target.count().catch(() => 0) : (target ? 1 : 0)
    if (!exists) throw new Error("Expected element to be truthy (exist), but it was not found")
  }

  // Override toHaveURL on Page objects to use async URL refresh
  if (target && typeof target._refreshUrl === "function") {
    const origToHaveURL = base.toHaveURL?.bind(base)
    base.toHaveURL = async (expected, opts) => {
      const timeout = opts?.timeout ?? 15000
      const deadline = Date.now() + timeout
      const pattern = expected instanceof RegExp ? expected : new RegExp(String(expected).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      while (Date.now() < deadline) {
        const url = await target._refreshUrl()
        if (typeof expected === "string" ? url.includes(expected) : pattern.test(url)) return
        await new Promise(r => setTimeout(r, 100))
      }
      const url = await target._refreshUrl()
      throw new Error(`Expected URL to match "${expected}" but got "${url}"`)
    }
  }

  return base
}

// ---------------------------------------------------------------------------
// test wrapper: converts ({ page }) => {} → (page) => {}
// ---------------------------------------------------------------------------

function wrapFn(fn) {
  return async (page) => {
    patchPage(page)
    return fn({ page })
  }
}

export const test = Object.assign(
  (name, fn, opts) => kazeTest(name, wrapFn(fn), opts),
  {
    only:     (name, fn, opts) => kazeTest.only(name, wrapFn(fn), opts),
    skip:     (name, fn)       => kazeTest.skip(name, wrapFn(fn)),
    describe: kazeTest.describe,
    retry:    kazeTest.retry,
  }
)
