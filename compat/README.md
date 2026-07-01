# kaze Playwright Compatibility Layer

This directory contains tools for running Playwright-style tests on kaze.

## Files

| File | Purpose |
|------|---------|
| `shim.mjs` | Playwright → kaze compatibility shim |
| `runner.mjs` | Generic test runner |
| `bench.mjs` | Playwright vs kaze performance comparison |
| `example.spec.js` | Sample spec using the shim |
| `issues.json` | Known compatibility issues tracker |

---

## shim.mjs — Usage

Import `test` and `expect` from the shim instead of `@playwright/test`:

```js
// Before (Playwright)
import { test, expect } from "@playwright/test"

// After (kaze via shim)
import { test, expect } from "./compat/shim.mjs"
```

The shim converts `async ({ page }) => {}` test functions to kaze's `async (page) => {}` signature automatically.

### Environment variables

| Variable | Description |
|----------|-------------|
| `KAZE_BASE_URL` | Base URL prepended to relative `page.goto()` paths |
| `BASE_URL` | Fallback alias for `KAZE_BASE_URL` |

### Supported APIs

- `page.goto(url)` — with optional `baseURL` prefix
- `page.locator(selector)` — CSS / XPath selectors
- `page.click(selector)` — shorthand click
- `page.fill(selector, value)` — input fill
- `page.screenshot({ path })` — saves PNG to disk
- `page.evaluate(fn)` — executes JS in browser context
- `page.url()` — returns current URL synchronously
- `expect(locator).toHaveText(text)` — kaze native
- `expect(locator).toContainText(text)` — partial text match (added by shim)
- `expect(locator).toBeGreaterThan(n)` — numeric text comparison (added by shim)
- `expect(locator).toBeTruthy()` — existence check (added by shim)
- `expect(primitiveValue).toEqual/toContain/toBeGreaterThan/toBeTruthy()` — primitive assertions

---

## runner.mjs — Usage

```bash
node compat/runner.mjs <spec-file> [--base-url=http://...] [--json] [--workers=N]
```

**Examples:**

```bash
# Run example spec against local fixture
node compat/runner.mjs compat/example.spec.js

# Run against a live server with JSON output
node compat/runner.mjs my-tests/home.spec.js \
  --base-url=http://localhost:3000 \
  --json

# Increase parallelism
node compat/runner.mjs my-tests/ --workers=4
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--base-url=<url>` | `$KAZE_BASE_URL` | Base URL for relative `goto()` paths |
| `--json` | off | Write results to `compat-results.json` |
| `--workers=N` | `2` | Parallel browser workers |

---

## bench.mjs — Usage

Requires both kaze and `@playwright/test` to be installed (Playwright is a devDependency).

```bash
node compat/bench.mjs <spec-file> --base-url=http://localhost:3000 [--runs=3]
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--base-url=<url>` | — | Base URL |
| `--runs=N` | `3` | Number of repetitions for averaging |
| `--kaze-only` | off | Skip Playwright, measure kaze only |

**Example output:**

```
kaze compat bench
  spec : /path/to/my.spec.js
  runs : 3
  url  : http://localhost:3000

  Run 1/3... done
  Run 2/3... done
  Run 3/3... done

======================================================================
Per-test comparison (avg ms across runs)
======================================================================
------------------------------------------------------------------
 Test name                     | kaze (ms) | Playwright (ms) | Speedup
------------------------------------------------------------------
 home page loads                |    312    |     1840        | 5.90x
 click button                   |     48    |      210        | 4.38x
------------------------------------------------------------------
```

---

## Known compatibility issues

See [`issues.json`](./issues.json) for the full list.

| ID | API | Status | Workaround |
|----|-----|--------|------------|
| PW001 | `page.getByRole` | not-implemented | Use `page.locator('[role="..."]')` |
| PW002 | `page.evaluate` | partial | Available; complex types may not serialize |
| PW003 | `page.getByText` | not-implemented | Use `page.locator(':text("...")')` |
| PW004 | `page.getByLabel` | not-implemented | Locate label then input by `for` attribute |
| PW005 | `page.getByPlaceholder` | not-implemented | Use `page.locator('[placeholder="..."]')` |
| PW006 | `page.getByTestId` | not-implemented | Use `page.locator('[data-testid="..."]')` |
| PW007 | `page.waitForLoadState` | not-implemented | Use `page.waitForSelector()` |
| PW008 | `page.waitForURL` | not-implemented | Poll `page.url()` |
| PW009 | `frameLocator` | not-implemented | Main-frame tests only |
| PW010 | `page.dragAndDrop` | not-implemented | Dispatch mouse events via `page.evaluate()` |
| PW011 | `page.route` | partial | Use kaze's Route API |
| PW012 | `expect(locator).toHaveCount` | not-implemented | Use `locator.count()` with primitive expect |
| PW013 | `expect(locator).toBeVisible` | not-implemented | Use `locator.isVisible()` |

---

## Reporting a new issue

1. Identify the failing Playwright API (e.g. `page.getByRole`).
2. Check `issues.json` — it may already be tracked.
3. If it is new, open a GitHub Issue with:
   - The API name
   - A minimal reproducing test case
   - The error message you received
4. Optionally add an entry to `issues.json` and open a PR.

**Issue entry format:**

```json
{
  "id": "PW014",
  "api": "page.someApi",
  "status": "not-implemented",
  "description": "What this API does in Playwright.",
  "workaround": "How to achieve the same result in kaze."
}
```

Status values: `not-implemented` | `partial` | `implemented` | `wont-implement`
