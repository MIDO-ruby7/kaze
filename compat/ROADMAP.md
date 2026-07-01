# kaze Playwright Compatibility Roadmap

> Last updated: 2026-07-02
> **Best compatibility: 77% (20/26 tests across 10 OSS) — STABLE**

---

## Compatibility History

| Version | Pass | Rate | Key Changes |
|---------|------|------|-------------|
| v1 | 9/26 | 35% | — |
| v2 | 14/26 | 54% | `locator.first/last/nth` |
| v3 | 16/26 | 62% | Epic #43: getBy*, CDP click, matcher 拡張 |
| v4 | 16/26 | 62% | scrollIntoView fallback, perf 最適化 |
| v5 | 20/26 | 77% | awaitPromise, SPA wait, localStorage clear |
| v6 | 19/26 | 73% | ※ Storage.clearDataForOrigin リグレッション期間 |
| v7 | 19/26 | 73% | ※ click 2000ms ループリグレッション期間 |
| **v11+** | **20/26** | **77%** | mouseMoved revert, NthLocator all(), STABLE |

---

## Current Test Results (v8)

| OSS | Pass | Status |
|-----|------|--------|
| playwright-todomvc | 3/3 | ✅ Full pass |
| the-internet | 2/3 | ⚠️ 1 flaky (server session) |
| playwright-dev | 2/3 | ⚠️ all() attribute issue |
| demoqa | 1/2 | ⚠️ dynamic render timeout |
| automationintesting | 2/2 | ✅ Full pass |
| saucedemo | 1/3 | ⚠️ React SPA click |
| github-login | 2/2 | ✅ Full pass |
| wikipedia | 2/2 | ✅ Full pass |
| jsonplaceholder | 2/2 | ✅ Full pass |
| runteq-studio | 3/4 | ⚠️ SPA redirect (app-side) |

---

## Implemented APIs ✅

### Selectors
- `page.locator(selector)` — CSS, attribute, `:text()` pseudo-selector
- `page.getByText(text, { exact? })` — partial match (default)
- `page.getByLabel(text)` — `<label>` association
- `page.getByPlaceholder(text)` — placeholder attribute
- `page.getByTestId(id)` — `[data-testid]`
- `page.getByRole(role, { name?, exact? })` — 70+ ARIA roles
- Comma-separated selectors with `.first()/.nth()` ✅

### Locator methods
- `click/fill/hover/check/uncheck/selectOption/screenshot` ✅
- `textContent/innerText/getAttribute/inputValue` ✅
- `isVisible/isEnabled` ✅
- `count/all/first/last/nth` ✅
- `waitFor({ state })` ✅
- `filter({ hasText, hasNotText })` ✅

### Page methods
- `goto/click/fill/keyboard.press` ✅
- `evaluate()` with `awaitPromise: true` ✅
- `waitForURL/waitForLoadState` ✅
- `route/unroute` ✅
- `screenshot/title` ✅

### Assertions
- All standard matchers + `expect(locator).not.*` ✅
- `toHaveClass/toHaveAttribute/toContainText` ✅

### Infrastructure
- CDP `Input.dispatchMouseEvent` (real click) ✅
- scrollIntoView before click (with post-scroll verification) ✅
- SPA navigation await after click (150ms+300ms pattern) ✅
- localStorage/sessionStorage clear on reset ✅
- Context prewarming ✅
- `awaitPromise: true` for evaluate ✅

---

## Remaining Gaps

| Issue | Root Cause | Effort |
|-------|-----------|--------|
| saucedemo React SPA | Form submit doesn't trigger URL navigation | M |
| demoqa .rct-node | Tree component requires scroll + render time | S |
| playwright-dev all() | `[data-kz-all-*]` attribute stale after reuse | S |
| the-internet session | Server session persists across tests | S |

---

## How to Run Compat Tests

```bash
# Single test
node --import tsx/esm compat/runner.mjs your-test.js [--base-url=...]

# Benchmark vs Playwright
node --import tsx/esm compat/bench.mjs your-test.js --base-url=...

# Known issues
cat compat/issues.json
```
