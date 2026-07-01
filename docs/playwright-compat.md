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
| `test.only` | Supported | Runs only `.only` tests across **all spec files in the same run** (cross-file scope) |
| `test.describe.only(name, fn)` | Supported | Runs only the matched describe block(s) |
| `test.describe.skip(name, fn)` | Supported | Skips the matched describe block(s) |
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
| `page.getByText(text, opts?)` | Supported | Partial match by default; `{ exact: true }` for exact match; evaluate-based DOM scan |
| `page.getByLabel(text, opts?)` | Supported | Finds input/select/textarea via `for`/id association or nesting; partial match by default |
| `page.getByPlaceholder(text, opts?)` | Supported | Partial match by default (`placeholder` attribute); `{ exact: true }` for exact match |
| `page.getByTestId(id)` | Supported | Returns `Locator` for `[data-testid="id"]` |
| `page.url()` | Supported | |
| `page.title()` | Supported | Returns `document.title` |
| `page.close()` | Supported | |
| `page.screenshot(opts?)` | Supported | Returns PNG as `Buffer`; falls back to canvas-based capture when adapter lacks native support |
| `page.keyboard.press(key)` | Supported | Dispatches `keydown` + `keyup` events; e.g. `"Enter"`, `"Tab"`, `"Escape"` |
| `page.evaluate(fn)` | Not supported (internal only) | Use `_evaluate` at your own risk |
| `page.waitForNavigation()` | Not supported | Not supported — use `page.waitForURL()` instead |
| `page.waitForURL(url, opts?)` | Supported | Accepts exact string, glob (`**`), or RegExp; polls every 100ms; default timeout 30000ms |
| `page.waitForLoadState(state?, opts?)` | Supported | States: `load` (default), `domcontentloaded`, `networkidle` (500ms no-traffic); default timeout 30000ms |
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
| `locator.textContent()` | Supported | auto-waiting; default timeout 30000ms; accepts `{ timeout }` option; includes hidden text (`el.textContent`); use `innerText()` for visible text only |
| `locator.count()` | Supported | Returns number of matching elements |
| `locator.all()` | Supported | Returns `Locator[]` for each matching element via `data-kaze-idx` attribute |
| `locator.check(opts?)` | Supported | auto-waiting; sets `checked = true` and dispatches `change` event |
| `locator.uncheck(opts?)` | Supported | auto-waiting; sets `checked = false` and dispatches `change` event |
| `locator.selectOption(value, opts?)` | Supported | auto-waiting; accepts string (value), number (index), or `{ label }` / `{ value }` object |
| `locator.hover(opts?)` | Supported | auto-waiting; dispatches `mouseover` event |
| `locator.isVisible()` | Supported | Immediate (no auto-waiting); checks computed style |
| `locator.isEnabled()` | Supported | Immediate (no auto-waiting); checks `el.disabled` |
| `locator.inputValue()` | Supported | auto-waiting; returns `el.value` of input/textarea |
| `locator.nth(index)` | Supported | Returns `NthLocator`; 0-indexed; works with comma selectors |
| `locator.first()` / `locator.last()` | Supported | Returns `NthLocator`; works with comma selectors |
| `locator.filter()` | Not supported | — |
| `locator.waitFor()` | Not supported | Use `page.waitForSelector()` |
| `locator.getAttribute(name, opts?)` | Supported | auto-waiting; returns `null` when attribute absent; default timeout 30000ms |
| `locator.innerText(opts?)` | Supported | auto-waiting; returns visible text only (`el.innerText`); default timeout 30000ms |

### `expect` matchers

| Matcher | Status | Notes |
|---------|--------|-------|
| `expect(locator).toHaveText(value)` | Supported | Auto-retry up to 5s |
| `expect(locator).toBeVisible()` | Supported | Auto-retry up to 5s |
| `expect(locator).toBeChecked()` | Supported | Auto-retry up to 5s |
| `expect(locator).toBeEnabled()` | Supported | Auto-retry up to 5s |
| `expect(locator).toBeDisabled()` | Supported | Auto-retry up to 5s |
| `expect(locator).toHaveValue(value)` | Supported | Auto-retry up to 5s; checks `el.value` |
| `expect(locator).toHaveCount(n)` | Supported | Auto-retry up to 5s |
| `expect(page).toHaveURL(url)` | Supported | Accepts string or RegExp |
| `expect(page).toHaveTitle(title)` | Supported | Auto-retry up to 5s; accepts string or RegExp |
| `expect(locator).toHaveClass(class)` | Supported | Auto-retry up to 5s; word-boundary match (space-separated classList) |
| `expect(locator).toHaveAttribute(name, value)` | Supported | Auto-retry up to 5s; accepts string (exact) or RegExp |
| `expect(locator).toContainText(text)` | Supported | Auto-retry up to 5s; accepts string (substring) or RegExp |
| `expect(locator).toBeHidden()` | Not supported | — |
| Soft assertions (`expect.soft`) | Not supported | — |

### CLI フィルタ

| オプション | Status | Notes |
|-----------|--------|-------|
| `--grep <pattern>` | Supported | テスト名を正規表現でフィルタ。`kaze.config.ts` の `grep` フィールドでも設定可 |
| `--grep-invert <pattern>` | Supported | テスト名を正規表現で除外。`kaze.config.ts` の `grepInvert` フィールドでも設定可 |

---

## Roadmap

- `test.beforeEach` / `test.afterEach`
- `expect(locator).toBeHidden()`
- BiDi protocol support
