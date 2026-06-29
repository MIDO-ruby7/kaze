# Playwright Compatibility

This document lists the Playwright APIs that kaze implements and those that are not yet supported.

## Migration

Replace your import:

```typescript
// Before (Playwright)
import { test, expect } from '@playwright/test';

// After (kaze)
import { test, expect } from 'kaze';
```

The `fn` signature also changes slightly: kaze passes `page` as a direct argument rather than a fixture object.

```typescript
// Playwright
test('my test', async ({ page }) => { ... });

// kaze
test('my test', async (page) => { ... });
```

---

## Supported APIs

### `test`

| API | Status | Notes |
|-----|--------|-------|
| `test(name, fn)` | Supported | `fn` receives `Page` directly (not a fixtures object) |
| `test.describe(name, fn)` | Supported | |
| `test.skip(name, fn)` | Supported | Test is silently omitted |
| `test.only` | Not supported | — |
| `test.beforeEach` / `test.afterEach` | Not supported | — |
| `test.beforeAll` / `test.afterAll` | Not supported | — |
| `test.setTimeout` | Not supported | Pass `timeout` in `TestCase` via `collectTestCases` |
| Fixtures (`{ page, context, browser }`) | Not supported | `page` is passed as first argument |

### `Page`

| API | Status | Notes |
|-----|--------|-------|
| `page.goto(url, opts?)` | Supported | |
| `page.click(selector)` | Supported | auto-waiting; default timeout 30000ms; accepts `{ timeout }` option; retries if element detaches between selector check and click |
| `page.fill(selector, value)` | Supported | auto-waiting; default timeout 30000ms; accepts `{ timeout }` option; retries if element detaches between selector check and fill |
| `page.textContent(selector)` | Supported | auto-waiting; default timeout 30000ms; accepts `{ timeout }` option |
| `page.waitForSelector(selector, opts?)` | Supported | polls every 100ms; default timeout 30000ms; accepts `{ timeout }` option |
| `page.locator(selector)` | Supported | Returns `Locator` |
| `page.url()` | Supported | |
| `page.close()` | Supported | |
| `page.screenshot()` | Not supported | — |
| `page.evaluate(fn)` | Not supported (internal only) | Use `_evaluate` at your own risk |
| `page.waitForNavigation()` | Not supported | — |
| `page.waitForLoadState()` | Not supported | — |
| `page.keyboard` | Not supported | — |
| `page.mouse` | Not supported | — |
| `page.$$` / `page.$` | Not supported | Use `page.locator()` |
| `page.setViewportSize()` | Not supported | — |
| `page.addScriptTag()` | Not supported | — |

### `Locator`

| API | Status | Notes |
|-----|--------|-------|
| `page.locator(selector)` | Supported | |
| `locator.click()` | Supported | auto-waiting; default timeout 30000ms; accepts `{ timeout }` option; retries if element detaches between selector check and click |
| `locator.fill(value)` | Supported | auto-waiting; default timeout 30000ms; accepts `{ timeout }` option; retries if element detaches between selector check and fill |
| `locator.textContent()` | Supported | auto-waiting; default timeout 30000ms; accepts `{ timeout }` option |
| `locator.nth(index)` | Not supported | — |
| `locator.first()` / `locator.last()` | Not supported | — |
| `locator.filter()` | Not supported | — |
| `locator.waitFor()` | Not supported | Use `page.waitForSelector()` |
| `locator.getAttribute()` | Not supported | — |
| `locator.inputValue()` | Not supported | — |
| `locator.isVisible()` | Not supported | Use `expect(locator).toBeVisible()` |

### `expect` matchers

| Matcher | Status | Notes |
|---------|--------|-------|
| `expect(locator).toHaveText(value)` | Supported | Auto-retry up to 5s |
| `expect(locator).toBeVisible()` | Supported | Auto-retry up to 5s |
| `expect(page).toHaveURL(url)` | Supported | Accepts string or RegExp |
| `expect(locator).toHaveValue()` | Not supported | — |
| `expect(locator).toBeChecked()` | Not supported | — |
| `expect(locator).toBeEnabled()` | Not supported | — |
| `expect(locator).toBeDisabled()` | Not supported | — |
| `expect(locator).toBeHidden()` | Not supported | — |
| `expect(locator).toHaveAttribute()` | Not supported | — |
| `expect(locator).toHaveCount()` | Not supported | — |
| `expect(page).toHaveTitle()` | Not supported | — |
| Soft assertions (`expect.soft`) | Not supported | — |

---

## Roadmap

- `test.beforeEach` / `test.afterEach`
- `locator.getAttribute()` / `locator.inputValue()`
- `expect(locator).toHaveValue()`
- `page.screenshot()`
- BiDi protocol support
