# kaze Playwright Compatibility Roadmap

> Last updated: 2026-07-02
> **Best compatibility: 98% (43/44 tests across 20 OSS) — v12**

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
| v11+ | 20/26 | 77% | mouseMoved revert, NthLocator all(), STABLE |
| **v12** | **43/44** | **98%** | viewport fix, React fill(), waitUntil, +10 new OSS |

---

## Current Test Results (v12)

### Original 10 OSS — 23/24 = 96%

| OSS | Pass | Status |
|-----|------|--------|
| playwright-todomvc (knockoutjs) | 3/3 | ✅ Full pass |
| the-internet | 2/2 | ✅ Full pass |
| playwright-dev | 3/3 | ✅ Full pass (viewport fix) |
| demoqa | 1/2 | ⚠️ .rct-node tree component timeout |
| automationintesting | 2/2 | ✅ Full pass |
| saucedemo | 3/3 | ✅ Full pass (React fill fix) |
| github-login | 2/2 | ✅ Full pass |
| wikipedia | 2/2 | ✅ Full pass (h1.html-heading) |
| jsonplaceholder | 2/2 | ✅ Full pass |
| runteq-studio | 2/2 | ✅ Full pass |

### New 10 OSS — 20/20 = 100%

| OSS | Pass | Status |
|-----|------|--------|
| vue-todomvc (/dist/) | 2/2 | ✅ Full pass |
| angular-todomvc (angular/dist/browser/) | 2/2 | ✅ Full pass |
| uitesting-playground | 2/2 | ✅ Full pass |
| svelte-dev | 2/2 | ✅ Full pass |
| react-dev | 2/2 | ✅ Full pass |
| selenium-forms | 3/3 | ✅ Full pass |
| practicesoftwaretesting | 2/2 | ✅ Full pass |
| astro-build | 2/2 | ✅ Full pass |
| vitest-dev | 2/2 | ✅ Full pass |
| testing-library | 2/2 | ✅ Full pass |

---

## Key Fixes in v12

| Fix | Issue | Impact |
|-----|-------|--------|
| Viewport 1280×720 | Headless Chrome uses tiny default viewport → responsive CSS hides nav items | playwright-dev 3/3 |
| React fill() nativeSetter | `el.value = x` bypassed by React's controlled-input tracker | saucedemo 3/3 |
| `goto() waitUntil: 'networkidle'` | CSR frameworks (Vue/Angular/React) render after network idle | practicesoftwaretesting, testing-library |
| todomvc.com URL updates | `vanillajs/` and `angularjs/` removed in June 2026 update | playwright-todomvc, angular-todomvc |
| Wikipedia h1 | Main page uses `display:none` h1; visible one is `h1.html-heading` | wikipedia 2/2 |

---

## Remaining Gaps

| Issue | Root Cause | Effort |
|-------|-----------|--------|
| demoqa .rct-node | Tree component requires scroll + dynamic render time | S |

## Notes

- `todomvc.com/examples/vanillajs/` and `todomvc.com/examples/angularjs/` return 404 since June 2026.
  Use `knockoutjs/` and `angular/dist/browser/` instead.
- `todomvc.com/examples/vue/dist/` works; root `/examples/vue/` path is broken (Vite dev-server `/src/main.js` → 404).
- `waitUntil: 'networkidle'` in `goto()` is required for CSR-only apps without pre-rendered HTML.
- Wikipedia CDX Search: `keyboard.press('Enter')` doesn't trigger navigation via Vue's CDX handler.
  Use direct URL navigation for search tests.

---

## How to Run Compat Tests

```bash
# Single test
node --import tsx/esm compat/runner.mjs your-test.js

# Benchmark vs Playwright
node --import tsx/esm compat/bench.mjs your-test.js
```
