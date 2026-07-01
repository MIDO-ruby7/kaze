# kaze vs Playwright — OSS Compatibility Report

**Date:** 2026-07-01

---

## BEFORE vs AFTER: locator.first / locator.last / locator.nth

| Suite | Before | After | Delta |
|-------|--------|-------|-------|
| playwright-todomvc | ⚠️ 1/3 | ⚠️ 1/3 | — |
| the-internet | ⚠️ 1/3 | ⚠️ 1/3 | — |
| playwright-dev | ⚠️ 1/3 | ⚠️ 2/3 | +1 ✅ |
| demoqa | ⚠️ 1/2 | ⚠️ 1/2 | — |
| automationintesting | ❌ 0/2 | ✅ 2/2 | +2 ✅ |
| saucedemo | ⚠️ 1/3 | ⚠️ 1/3 | — |
| github-login | ⚠️ 1/2 | ✅ 2/2 | +1 ✅ |
| wikipedia | ❌ 0/2 | ❌ 0/2 | — |
| jsonplaceholder | ❌ 0/2 | ⚠️ 1/2 | +1 ✅ |
| runteq-studio | ⚠️ 3/4 | ⚠️ 3/4 | — |
| **Total** | **9/26 (34.6%)** | **14/26 (53.8%)** | **+5 (+19.2 pp)** |

Legend: ✅ all passed  ⚠️ partial  ❌ all failed

---

## Improvement Delta

- **Before:** 9/26 passed (34.6%)
- **After:** 14/26 passed (53.8%)
- **+5 tests, +19.2 percentage points**

Suites that improved with this change:
- `automationintesting`: 0→2 — fully green (was entirely blocked by locator.first)
- `github-login`: 1→2 — fully green (+1 from locator.first unblock)
- `playwright-dev`: 1→2 (+1)
- `jsonplaceholder`: 0→1 (+1)

---

## Remaining Gaps

### playwright-todomvc (1/3)
- **`keyboard.press` (Enter)** — Enter key not triggering todo submission in the input field
- **`locator.click` on toggle** — toggle click not working or navigation loses SPA state after action

Errors:
```
add a todo item: expect(locator).toHaveCount(1) — Selector: .todo-list li, Received: 0
mark item as complete: Test timed out after 30000ms
```

### the-internet (1/3)
- Login flow tests time out (30 s) — form submission or post-click navigation wait not resolving

Errors:
```
"login with valid credentials" timed out after 30000ms
"shows error on invalid login" timed out after 30000ms
```

### playwright-dev (2/3)
- `a[href*="intro"]` not matching a visible element within 5 s — possible timing or scroll issue

Errors:
```
has get started link: expect(locator).toBeVisible() — Selector: a[href*="intro"] — Timeout: 5000ms
```

### demoqa (1/2)
- `.rct-node` not visible within 5 s — tree component may require scroll or delayed render

Errors:
```
checkbox tree renders: expect(locator).toBeVisible() — Selector: .rct-node — Timeout: 5000ms
```

### saucedemo (1/3)
- Login does not navigate to `/inventory/` — page stays at root after submit
- `.inventory_item` count is 0 — dependent on successful login navigation

Errors:
```
login with valid credentials: expect(page).toHaveURL(/inventory/) — Received: https://www.saucedemo.com/
products page shows 6 items: expect(locator).toHaveCount(6) — Selector: .inventory_item, Received: 0
```

### wikipedia (0/2)
- CSS multi-selector with `locator.first` still not resolving (`h1, #mp-welcome`)
- `locator.first` listed as an API gap — may not be wired for comma-separated selectors

Errors:
```
expect(locator).toBeVisible() — Selector: h1, #mp-welcome — Timeout: 5000ms
expect(locator).toBeVisible() — Selector: h1, .mw-page-title-main — Timeout: 5000ms
```

API gaps: `locator.first`

### jsonplaceholder (1/2)
- `page.evaluate` fetch with relative URL returns empty object `{}`
- Evaluate context may not have origin set, or `fetch` is not available inside the sandbox

Errors:
```
fetch via evaluate works: fetch failed: {}
```

API gaps: `locator.first`, `page.evaluate fetch (relative URL fetch returned empty object)`

### runteq-studio (3/4)
- One test still failing (pre-built result — no error detail available)

---

## Next Recommended Fixes (Priority Order)

| Priority | Fix | Expected impact |
|----------|-----|----------------|
| P0 | Fix `locator.first` for CSS multi-selectors (`h1, #mp-welcome`) | Unblocks wikipedia (0→2) |
| P1 | Fix `page.evaluate` fetch origin / sandbox access | Unblocks jsonplaceholder remaining test |
| P2 | Fix `keyboard.press` Enter dispatch on input fields | Unblocks playwright-todomvc todo-add test |
| P3 | Fix post-click navigation wait (login flows) | Unblocks the-internet, saucedemo |
| P4 | Fix `toBeVisible` assertion retry timing | Unblocks demoqa, playwright-dev |

Fixing P0 + P1 alone would raise the total to an estimated **16/26 (61.5%)**.
Addressing P2 + P3 on top would push above **20/26 (76.9%)**.

---

## Baseline Report (Before this change)

Overall compatibility rate: **35% (9/26 tests passed)**

The primary blocker at that point was `locator.first()` not implemented at all, which blocked 5 suites entirely.
This change implemented `locator.first`, `locator.last`, and `locator.nth`, resolving the straightforward cases.
The remaining wikipedia failure suggests `locator.first()` on a CSS multi-selector (comma-separated) still needs attention.
