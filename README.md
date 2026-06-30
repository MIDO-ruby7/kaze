<div align="center">

# kaze 風

**A fast, isolation-first E2E testing framework built on Chrome DevTools Protocol.**

[![npm](https://img.shields.io/npm/v/@midori/kaze?color=0ea5e9&label=%40midori%2Fkaze)](https://www.npmjs.com/package/@midori/kaze)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)

[日本語](README.ja.md) · [中文](README.zh.md)

</div>

---

## Why kaze?

| | kaze | Playwright |
|---|---|---|
| **Speed** | 1.5–2.4× faster on equivalent workloads | Baseline |
| **RAM (300 parallel)** | ~25 GB | ~105 GB |
| **Isolation** | Full per-test (cookies, IndexedDB, Service Workers) | Per-context |
| **API** | Playwright-compatible subset | Full |

kaze runs tests in a **shared browser pool** — multiple contexts per process instead of one browser per worker — giving you more parallelism for less RAM.

---

## Quick Start

```bash
pnpm add -D @midori/kaze tsx
```

```typescript
// tests/example.spec.ts
import { test, expect } from "@midori/kaze"

test("homepage loads", async (page) => {
  await page.goto("https://example.com")
  await expect(page.locator("h1")).toHaveText("Example Domain")
})
```

```bash
npx kaze
```

---

## Installation

```bash
# npm
npm install -D @midori/kaze tsx

# pnpm
pnpm add -D @midori/kaze tsx

# yarn
yarn add -D @midori/kaze tsx
```

> `tsx` is required to run TypeScript spec files. It is an optional peer dependency.

---

## Test API

### Writing tests

```typescript
import { test, expect, beforeEach, afterEach } from "@midori/kaze"

beforeEach(async () => {
  await db.beginTransaction()
})

afterEach(async () => {
  await db.rollback()
})

test("user can log in", async (page) => {
  await page.goto("/login")
  await page.fill("#email", "user@example.com")
  await page.fill("#password", "secret")
  await page.click("#submit")
  await expect(page).toHaveURL("/dashboard")
})

test.describe("cart", () => {
  test("add item", async (page) => { ... })
  test("remove item", async (page) => { ... })
})

// Run only this test (all others skipped)
test.only("focus this", async (page) => { ... })

// Skip
test.skip("flaky test", async (page) => { ... })

// Retry on failure
test.retry(2)("flaky network test", async (page) => { ... })
```

### Lifecycle hooks

| Hook | Scope |
|------|-------|
| `beforeAll(fn)` | Once before all tests in the enclosing `describe` |
| `afterAll(fn)` | Once after all tests in the enclosing `describe` |
| `beforeEach(fn)` | Before each test in scope |
| `afterEach(fn)` | After each test in scope |

---

## Page API

```typescript
// Navigation
await page.goto(url, { timeout? })
await page.waitForURL(url)                   // string | RegExp | glob
await page.waitForLoadState("networkidle")   // "load" | "domcontentloaded" | "networkidle"

// Interaction
await page.click(selector, { timeout? })
await page.fill(selector, value, { timeout? })
await page.keyboard.press("Enter")

// Queries
await page.title()
await page.screenshot()                      // → Buffer

// Network mocking
await page.route("/api/users", (route) => {
  route.fulfill({ json: [{ id: 1, name: "Alice" }] })
})
await page.unroute("/api/users")
```

---

## Locator API

```typescript
const btn = page.locator("#submit")

// Actions (all auto-wait up to 30s by default)
await btn.click({ timeout? })
await btn.fill("value", { timeout? })
await btn.hover()
await btn.check()
await btn.uncheck()
await btn.selectOption("value")

// Queries
await btn.textContent()    // includes hidden text
await btn.innerText()      // visible text only
await btn.getAttribute("href")
await btn.inputValue()
await btn.isVisible()      // instant (no retry)
await btn.isEnabled()      // instant (no retry)
await btn.count()
await btn.all()            // → Locator[]
```

---

## Assertions (`expect`)

```typescript
// Page
await expect(page).toHaveURL("/dashboard")
await expect(page).toHaveTitle("Dashboard")

// Locator
await expect(page.locator("h1")).toHaveText("Welcome")
await expect(page.locator("#status")).toBeVisible()
await expect(page.locator("#btn")).toBeEnabled()
await expect(page.locator("#btn")).toBeDisabled()
await expect(page.locator('[type=checkbox]')).toBeChecked()
await expect(page.locator("input")).toHaveValue("hello")
await expect(page.locator("li")).toHaveCount(5)
```

All matchers auto-retry for up to 30 seconds by default.

---

## CLI

```bash
kaze                              # run all *.spec.{ts,js}
kaze src/features/                # specific directory
kaze "**/*.spec.ts"               # glob pattern
kaze --watch                      # watch mode
kaze --workers=50                 # parallel workers
kaze --grep="login"               # filter by name
kaze --grep-invert="slow"         # exclude by name
kaze --retries=2                  # retry failing tests
kaze --shard=1/4                  # CI sharding
kaze --reporter=html              # generate .kaze/report/index.html
kaze --screenshot=off             # disable auto-screenshots
kaze test                         # "test" subcommand (backward compat)
```

---

## Configuration

```typescript
// kaze.config.ts
import { defineConfig } from "@midori/kaze"

export default defineConfig({
  workers: 20,            // parallel contexts (auto-detected from RAM/CPU if omitted)
  timeout: 30_000,        // ms per test (default: 30000)
  reporter: "verbose",    // "verbose" | "dot" | "html"
  testMatch: ["tests/**/*.spec.ts"],
  screenshot: true,       // auto-screenshot on failure
  retries: 0,             // default retries per test
  prewarm: true,          // pre-reset contexts in background (reduces inter-test latency)
  grep: "login",          // filter by name
  grepInvert: "slow",     // exclude by name
  shard: "1/4",           // or { index: 1, total: 4 }
})
```

CLI flags always override the config file.

---

## CI Integration

### GitHub Actions — parallel sharding

```yaml
jobs:
  e2e:
    strategy:
      matrix:
        shard: ["1/4", "2/4", "3/4", "4/4"]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: npx kaze --shard=${{ matrix.shard }} --workers=20
```

### Scale via `KAZE_WORKERS`

```bash
KAZE_WORKERS=100 npx kaze   # 10 browser processes × 10 contexts = 100 parallel
```

| Workers | kaze RAM | Playwright RAM |
|---------|----------|----------------|
| 20 | ~1.7 GB | ~6.8 GB |
| 100 | ~8.3 GB | ~34.2 GB |
| 300 | ~24.9 GB | ~102.5 GB |

---

## Screenshots

Failed and timed-out tests automatically save screenshots to `.kaze/screenshots/`.
The `.kaze/` directory is already in `.gitignore`.

```bash
kaze --screenshot=off   # disable
```

---

## HTML Reporter

```bash
kaze --reporter=html
# generates .kaze/report/index.html

kaze --reporter=html --output-dir=./test-results
```

---

## For AI Assistants

kaze follows the Playwright API closely. Key differences:

- Import from `@midori/kaze` instead of `@playwright/test`
- `test(name, async (page) => { ... })` — page is the first argument, no fixture destructuring
- `collectTestCases(pool)` is used internally; you don't call it directly
- `page.route()` supports string / glob / RegExp patterns
- All locator actions auto-wait; `isVisible()` / `isEnabled()` do **not** auto-wait

```typescript
// Playwright
import { test, expect } from "@playwright/test"
test("example", async ({ page }) => { ... })

// kaze
import { test, expect } from "@midori/kaze"
test("example", async (page) => { ... })
```

---

## Contributing

```bash
git clone https://github.com/MIDO-ruby7/kaze
cd kaze
pnpm install
pnpm test
```

---

## License

MIT © Midori Takahashi
