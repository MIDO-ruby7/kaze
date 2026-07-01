<div align="center">

<br />

```
  ██╗  ██╗ █████╗ ███████╗███████╗
  ██║ ██╔╝██╔══██╗╚══███╔╝██╔════╝
  █████╔╝ ███████║  ███╔╝ █████╗
  ██╔═██╗ ██╔══██║ ███╔╝  ██╔══╝
  ██║  ██╗██║  ██║███████╗███████╗
  ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝
```

**E2E testing. Faster. Leaner. Built on CDP.**

[![npm](https://img.shields.io/npm/v/@midori/kaze?color=0ea5e9&label=%40midori%2Fkaze&style=flat-square)](https://www.npmjs.com/package/@midori/kaze)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-64748b?style=flat-square)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-385%20passing-22c55e?style=flat-square)](#)

[日本語](README.ja.md) · [中文](README.zh.md)

<br />

</div>

---

## The problem with existing tools

Running 300 tests in parallel with Playwright costs **~105 GB of RAM** — one browser process per worker. Most CI machines don't have that. You shard across machines, pay for more runners, and wait longer.

kaze uses a **shared browser pool**: multiple contexts inside fewer processes. 300 parallel tests now costs **~25 GB**.

```
Playwright  300 workers = 300 browser processes × 350 MB = 105 GB
kaze        300 workers =  30 browser processes × 10 contexts = 25 GB
```

That's **4× less RAM** for the same concurrency. On a 32 GB CI machine, Playwright caps at ~8 workers. kaze runs 80+.

---

## Benchmark

> Local fixture (file:// URL), MacBook Air M1, 16 GB RAM

| Tests | Playwright | kaze | Speedup |
|-------|-----------|------|---------|
| 5 | 942 ms | **447 ms** | 2.1× faster |
| 20 | 2178 ms | **1785 ms** | 1.2× faster |
| 50 | 5111 ms | **4482 ms** | 1.1× faster |

Speed improves further on real E2E tests (network + server + rendering) where kaze's parallelism advantage compounds.

---

## How it's fast

kaze makes three bets that pay off:

**1. Multiplexed CDP sessions** — One WebSocket per browser process, not per page. All page commands flow through a shared connection with `sessionId` routing. This eliminates the ~540 ms WebSocket-per-page overhead in naive CDP implementations.

**2. In-place context reset** — Instead of closing and recreating a browser context (~700 ms), kaze calls `Network.clearBrowserCookies` (~4 ms) and lets the next `page.goto()` reset the DOM. Full cookie isolation (including HttpOnly) without the startup cost.

**3. Context prewarming** — While test N is running, kaze proactively resets the next context in the background. When test N finishes, a fresh context is ready immediately — zero waiting.

---

## Quick Start

```bash
pnpm add -D @midori/kaze tsx
```

```typescript
// tests/login.spec.ts
import { test, expect } from "@midori/kaze"

test("user can log in", async (page) => {
  await page.goto("/login")
  await page.fill("#email", "alice@example.com")
  await page.click("#submit")
  await expect(page).toHaveURL("/dashboard")
  await expect(page.locator("h1")).toHaveText("Welcome, Alice")
})
```

```bash
npx kaze
```

That's it. No config required.

---

## Migrating from Playwright

### Step 1 — Install kaze

```bash
pnpm add -D @midori/kaze tsx
pnpm remove @playwright/test   # optional
```

### Step 2 — Change the import and argument shape

This is the only required code change in 95% of tests:

```diff
- import { test, expect } from "@playwright/test"
+ import { test, expect } from "@midori/kaze"

- test("user can log in", async ({ page }) => {
+ test("user can log in", async (page) => {
    await page.goto("/login")
    await page.fill("#email", "user@example.com")
    await page.click("#submit")
    await expect(page).toHaveURL("/dashboard")
  })
```

### Step 3 — Replace the config file

```diff
- // playwright.config.ts
- import { defineConfig } from "@playwright/test"
+ // kaze.config.ts
+ import { defineConfig } from "@midori/kaze"

  export default defineConfig({
-   use: { baseURL: "http://localhost:3000" },
-   testDir: "./e2e",
+   testMatch: ["e2e/**/*.spec.ts"],
    timeout: 30_000,
    workers: 4,
  })
```

> kaze does not have a `baseURL` option yet. Prefix URLs manually or use an env var.

### Step 4 — Run

```bash
npx kaze          # replaces: npx playwright test
npx kaze --watch  # replaces: npx playwright test --ui
```

### What changes

| Playwright | kaze |
|------------|------|
| `async ({ page })` | `async (page)` — no destructuring |
| `@playwright/test` | `@midori/kaze` |
| `playwright.config.ts` | `kaze.config.ts` |
| `test.use({ baseURL })` | env var or manual prefix |
| `--reporter=html` | `--reporter=html` ✓ same |
| `--shard=1/4` | `--shard=1/4` ✓ same |

### What is not supported (yet)

| Feature | Status |
|---------|--------|
| `page.getByRole()` / `getByText()` / `getByLabel()` | ❌ Use `page.locator()` |
| `test.use({ storageState })` | ❌ Use `beforeEach` + `page.evaluate` |
| Multiple browsers (Firefox, WebKit) | ❌ Chromium only |
| `test.step()` | ❌ Not implemented |
| `request` fixture (API testing) | ❌ Use `page.evaluate` + fetch |
| `page.waitForNavigation()` | ❌ Use `page.waitForURL()` |
| `expect.soft()` | ❌ Not implemented |

### Gradual migration with the compat shim

If you have hundreds of existing tests, use the drop-in compat shim for a gradual migration.
The shim converts `async ({ page }) => {}` to kaze's `async (page) => {}` at runtime:

```bash
# 1. Copy the shim into your project
cp node_modules/@midori/kaze/compat/shim.mjs tests/playwright-compat.mjs
```

```diff
- import { test, expect } from "@playwright/test"
+ import { test, expect } from "./playwright-compat.mjs"

# No other changes needed — { page } destructuring works as-is
test("existing test", async ({ page }) => {   // ← unchanged!
  await page.goto("/")
})
```

```bash
# 2. Run with kaze
KAZE_BASE_URL=http://localhost:3000 npx kaze tests/
```

Migrate tests file-by-file to the native kaze API when you're ready.

> See [`docs/playwright-compat.md`](docs/playwright-compat.md) for the full API compatibility table.

---

## API Reference

### `test()`

```typescript
test(name, async (page) => { ... })
test.only(name, fn)          // run only this test
test.skip(name, fn)          // skip this test
test.retry(n)(name, fn)      // retry up to n times on failure

test.describe(name, () => {
  test.describe.only(...)
  test.describe.skip(...)
})
```

### Lifecycle hooks

```typescript
import { beforeAll, afterAll, beforeEach, afterEach } from "@midori/kaze"

// Scoped to the enclosing describe block
beforeAll(async () => { /* runs once before all tests */ })
afterAll(async () => { /* runs once after all tests */ })
beforeEach(async () => { /* runs before each test */ })
afterEach(async () => { /* runs after each test */ })
```

### `page`

```typescript
// Navigation
page.goto(url, { timeout? })
page.waitForURL(url)              // string | RegExp | "**/*.html"
page.waitForLoadState(state)      // "load" | "domcontentloaded" | "networkidle"
page.title()
page.screenshot()                 // → Buffer

// Input
page.click(selector, { timeout? })
page.fill(selector, value, { timeout? })
page.keyboard.press("Enter")

// Network
page.route(pattern, handler)      // intercept requests
page.unroute(pattern)
```

### `locator`

```typescript
const el = page.locator(selector)

// Actions — all auto-wait up to 30 s
el.click({ timeout? })
el.fill(value, { timeout? })
el.hover()
el.check()
el.uncheck()
el.selectOption(value)

// Reads — with auto-wait
el.textContent()      // includes hidden nodes
el.innerText()        // visible text only
el.getAttribute(name)
el.inputValue()

// Reads — instant, no retry
el.isVisible()
el.isEnabled()
el.count()
el.all()              // → Locator[]
```

### `expect()`

```typescript
// Page
expect(page).toHaveURL(url)
expect(page).toHaveTitle(title)

// Locator — all auto-retry for 30 s
expect(el).toHaveText(text)
expect(el).toBeVisible()
expect(el).toBeEnabled()
expect(el).toBeDisabled()
expect(el).toBeChecked()
expect(el).toHaveValue(value)
expect(el).toHaveCount(n)
```

### Network mocking

```typescript
test("works without a backend", async (page) => {
  await page.route("/api/users", (route) => {
    route.fulfill({ json: [{ id: 1, name: "Alice" }] })
  })

  await page.goto("/users")
  await expect(page.locator(".user")).toHaveCount(1)
})
```

---

## CLI

```
kaze [pattern...] [options]

Patterns:
  kaze                       scan for *.spec.{ts,js}
  kaze src/features/         specific directory
  kaze "**/*.spec.ts"        glob

Options:
  --workers=N                parallel contexts (auto from RAM/CPU)
  --timeout=N                ms per test (default: 30000)
  --reporter=MODE            verbose | dot | html
  --output-dir=PATH          HTML report directory (default: .kaze/report)
  --watch, -w                re-run on file change
  --grep=PATTERN             only run tests matching regex
  --grep-invert=PATTERN      exclude tests matching regex
  --retries=N                retry failing tests N times
  --shard=INDEX/TOTAL        e.g. --shard=1/10
  --screenshot=off           disable auto-screenshots
  -h, --help                 show help
```

---

## Configuration

```typescript
// kaze.config.ts
import { defineConfig } from "@midori/kaze"

export default defineConfig({
  workers: 20,
  timeout: 30_000,
  reporter: "verbose",
  testMatch: ["tests/**/*.spec.ts"],
  screenshot: true,
  retries: 0,
  prewarm: true,        // context prewarming (default: on)
  grep: "login",
  shard: "1/4",
})
```

CLI flags override the config file. `KAZE_WORKERS=N` env var sets workers.

---

## CI Sharding

Split your test suite across machines with `--shard`:

```yaml
# .github/workflows/e2e.yml
jobs:
  test:
    strategy:
      matrix:
        shard: ["1/4", "2/4", "3/4", "4/4"]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: npx kaze --shard=${{ matrix.shard }} --workers=20
```

With 4 shards × 20 workers = **80 parallel contexts** from a single 16 GB machine.

### Memory comparison at scale

| Workers | kaze | Playwright |
|---------|------|-----------|
| 20 | ~1.7 GB | ~6.8 GB |
| 50 | ~4.2 GB | ~17.1 GB |
| 100 | ~8.3 GB | ~34.2 GB |
| 300 | ~24.9 GB | ~102.5 GB |

---

## Screenshots & HTML Reports

**Screenshots** — saved automatically to `.kaze/screenshots/` on failure or timeout.

**HTML report** — generated on demand:

```bash
kaze --reporter=html
# opens .kaze/report/index.html
```

The `.kaze/` directory is already in `.gitignore`.

---

## For AI Assistants

kaze is intentionally close to Playwright. When generating kaze tests, use these rules:

```typescript
// ✅ kaze
import { test, expect } from "@midori/kaze"
test("name", async (page) => { ... })          // page is first arg, not destructured

// ❌ Playwright
import { test, expect } from "@playwright/test"
test("name", async ({ page }) => { ... })       // Playwright uses fixture destructuring
```

**API shape differences from Playwright:**

| | kaze | Playwright |
|---|---|---|
| Import | `@midori/kaze` | `@playwright/test` |
| Test arg | `async (page)` | `async ({ page })` |
| Fixtures | Not supported | `{ page, request, context }` |
| Config | `kaze.config.ts` | `playwright.config.ts` |
| `test.step()` | Not supported | Supported |

**What kaze supports that's identical to Playwright:**
- All `page.*` methods listed above
- All `locator.*` methods listed above
- All `expect()` matchers listed above
- `test.describe`, `test.only`, `test.skip`, `test.retry`
- `beforeAll`, `afterAll`, `beforeEach`, `afterEach` with identical scoping rules
- `page.route()` / `route.fulfill()` / `route.continue()` / `route.abort()`

**Isolation model:**
Each test gets a fresh browser context. Cookies (including HttpOnly), localStorage, IndexedDB, and Service Workers are all cleared between tests. If you need database state cleanup, use `afterEach`.

---

## Architecture

```
kaze CLI (bin/kaze.js)
  └─ tsx loader  ←  TypeScript spec files
      └─ Scheduler  ←  failure-first queue, retry logic
          └─ BrowserPool  ←  N processes × M contexts
              └─ CdpAdapter  ←  multiplexed WebSocket sessions
                  └─ Chromium (headless)
```

**Why Chrome DevTools Protocol (CDP)?**
CDP is the lowest-latency path to Chromium for local automation. Competing protocols: WebDriver (slower, more round-trips) and WebDriver BiDi (W3C standard, better for remote/cross-browser, not yet feature-complete in 2026). kaze will migrate to BiDi when its `Network.intercept` and related features reach parity — unlocking Firefox support.

---

## Development

```bash
git clone https://github.com/MIDO-ruby7/kaze
cd kaze
pnpm install
pnpm test             # unit tests (no browser required)
pnpm bench            # performance benchmark vs Playwright
```

---

## License

MIT © Midori Takahashi
