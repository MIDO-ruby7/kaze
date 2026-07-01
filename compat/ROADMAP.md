# kaze Playwright Compatibility Roadmap

> Last updated: 2026-07-02
> Best compatibility: 62% (16/26 tests across 10 OSS) — v5 測定中

---

## Compatibility History

| Version | Pass | Rate | Key Changes |
|---------|------|------|-------------|
| v1 | 9/26 | 35% | — |
| v2 | 14/26 | 54% | `locator.first/last/nth` |
| v3 | 16/26 | 62% | Epic #43: getBy*, CDP click, matcher拡張 |
| v4 | 16/26 | 62% | scrollIntoView fallback, perf最適化 |
| v5 | TBD | TBD | SPA nav wait, awaitPromise, localStorage clear |

---

## Implemented APIs (✅ Done)

### Selectors
- `page.locator(selector)` ✅
- `page.getByText(text, { exact? })` ✅
- `page.getByLabel(text)` ✅
- `page.getByPlaceholder(text)` ✅
- `page.getByTestId(id)` ✅
- `page.getByRole(role, { name?, exact? })` ✅ (70+ ARIA roles)
- `:text("...")` selector syntax ✅
- Comma-separated selectors with `.first()/.nth()` ✅

### Locator methods
- `click/fill/hover/check/uncheck/selectOption` ✅
- `textContent/innerText/getAttribute/inputValue` ✅
- `isVisible/isEnabled` ✅
- `count/all/first/last/nth` ✅
- `waitFor({ state })` ✅
- `filter({ hasText, hasNotText })` ✅

### Page methods
- `goto/click/fill/keyboard.press` ✅
- `waitForURL/waitForLoadState` ✅
- `evaluate()` with `awaitPromise: true` ✅
- `route/unroute` ✅
- `screenshot/title` ✅
- `getByRole/getByText/getByLabel/getByPlaceholder/getByTestId` ✅

### Assertions
- `toHaveText/toBeVisible/toHaveURL/toHaveTitle` ✅
- `toBeChecked/toBeEnabled/toBeDisabled` ✅
- `toHaveClass/toHaveAttribute/toContainText` ✅
- `toHaveValue/toHaveCount` ✅
- `expect(locator).not.*` ✅

### Infrastructure
- CDP `Input.dispatchMouseEvent` (real click) ✅
- scrollIntoView before click ✅
- SPA navigation await after click ✅
- localStorage/sessionStorage clear on reset ✅
- Context prewarming ✅

---

## Remaining Issues

| Issue | Root Cause | Effort |
|-------|-----------|--------|
| SauceDemo React login | React SPA深い遷移待機 | M |
| demoqa scrollIntoView | 動的コンテンツの viewport 計算 | S |
| playwright-dev :text() / all() | data-kaze-idx 属性衝突 | S |
| wikipedia comma-selector | 複雑な複合セレクタ | S |

---

## P2 Features (future)

| Feature | Impact |
|---------|--------|
| iframe / frame support | Medium |
| drag-and-drop | Low |
| Firefox/WebKit (BiDi) | High |
