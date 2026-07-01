# kaze Playwright Compatibility Roadmap

> Last updated: 2026-07-01
> Current compatibility: 54% (14/26 tests across 10 OSS)
> Target: 80%+

---

## Compatibility Test Results (10 OSS)

| OSS | Pass | Status | Notes |
|-----|------|--------|-------|
| automationintesting | 2/2 | ✅ Full pass | |
| github-login | 2/2 | ✅ Full pass | |
| runteq-studio | 3/4 | ⚠️ Partial | SPA redirect (app-side) |
| playwright-dev | 2/3 | ⚠️ Partial | CSS selector edge case |
| demoqa | 1/2 | ⚠️ Partial | Dynamic render wait |
| jsonplaceholder | 1/2 | ⚠️ Partial | Relative URL fetch |
| playwright-todomvc | 1/3 | ⚠️ Partial | Enter key + SPA state |
| the-internet | 1/3 | ⚠️ Partial | Form submit CDP gap |
| saucedemo | 1/3 | ⚠️ Partial | React SPA click |
| wikipedia | 0/2 | ❌ Blocked | Comma-selector bug |

---

## Fix Priority

### 🔴 P0 — Quick wins (S/M, +10% expected)

| ID | Feature | Impact | Effort |
|----|---------|--------|--------|
| A-2 | `page.getByText(text)` | High | S |
| A-3 | `page.getByLabel(text)` | High | S |
| A-4 | `page.getByPlaceholder(text)` | Medium | S |
| A-5 | `page.getByTestId(id)` | Medium | S |
| C-1 | `expect(locator).toHaveClass(/pattern/)` | High | S |
| C-3 | `expect(locator).toHaveAttribute(name, value)` | Medium | S |
| C-4 | `expect(locator).toContainText()` (native, no shim) | High | S |
| B-2 | Fix comma-selector with `.first()` / `.nth()` | High | S |

### 🟡 P1 — Root cause fixes (M/L, +10% expected)

| ID | Feature | Impact | Effort |
|----|---------|--------|--------|
| B-1 | CDP `Input.dispatchMouseEvent` for click | Very High | M |
| A-1 | `page.getByRole(role, opts)` | Very High | M |

### 🟢 P2 — Advanced (future)

| ID | Feature | Impact | Effort |
|----|---------|--------|--------|
| D-1 | iframe / frame support | Medium | L |
| D-2 | drag-and-drop | Low | L |
| D-3 | `test.use({ storageState })` | Medium | M |
| D-4 | Firefox / WebKit (WebDriver BiDi) | High | XL |

---

## Root Cause Analysis

### Why clicks don't work in SPAs (B-1)
kaze uses `el.dispatchEvent(new MouseEvent('click', ...))` in JavaScript.
Playwright uses CDP `Input.dispatchMouseEvent` which injects a real OS-level mouse event.
React, Vue etc. often use synthetic event systems or delegate to the root, and JS dispatchEvent
sometimes doesn't propagate correctly through framework boundaries.

**Fix**: Add `Input.dispatchMouseEvent` + `Input.dispatchTouchEvent` to CdpAdapter.

### Why comma-selectors break with first()/nth() (B-2)
Our `NthLocator._resolveNth()` tags elements with `data-kaze-nth-{timestamp}`.
When the selector contains a comma (e.g. `h1, #mp-welcome`), the querySelectorAll works fine
but the tagged attribute can conflict across elements from different parts of the selector.

**Fix**: Validate/normalize comma-separated selectors in NthLocator.

---

## How to Run Compat Tests

```bash
# Single test file
node --import tsx/esm compat/runner.mjs your-test.js [--base-url=http://...] [--workers=N]

# Benchmark vs Playwright
node --import tsx/esm compat/bench.mjs your-test.js --base-url=http://...

# All known issues
cat compat/issues.json
```

---

## Implementation Status

| Feature | Status | PR |
|---------|--------|-----|
| locator.first/last/nth | ✅ Done | main |
| page.evaluate() | ✅ Done | main |
| keyboard.press keyCode fix | ✅ Done | main |
| page.url() post-click refresh | ✅ Done | main |
| getByText/Label/Placeholder/TestId | 🔲 TODO | — |
| toHaveClass / toHaveAttribute | 🔲 TODO | — |
| CDP Input.dispatchMouseEvent | 🔲 TODO | — |
| getByRole | 🔲 TODO | — |
