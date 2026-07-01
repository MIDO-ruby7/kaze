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

**E2E 测试。更快。更轻量。基于 CDP 构建。**

[![npm](https://img.shields.io/npm/v/@midori/kaze?color=0ea5e9&label=%40midori%2Fkaze&style=flat-square)](https://www.npmjs.com/package/@midori/kaze)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-64748b?style=flat-square)](https://nodejs.org/)

[English](README.md) · [日本語](README.ja.md)

<br />

</div>

---

## 现有工具的问题

使用 Playwright 运行 300 个并行测试需要 **约 105 GB 内存**——每个 worker 启动一个独立的浏览器进程。大多数 CI 机器做不到这一点，于是你不得不跨机器分片、支付更多的 runner 费用、等待更长时间。

kaze 使用**共享浏览器池**：更少的进程，每个进程内运行多个上下文。300 个并行测试只需要 **约 25 GB**。

```
Playwright  300 workers = 300 个浏览器进程 × 350 MB = 105 GB
kaze        300 workers =  30 个浏览器进程 × 10 个上下文 = 25 GB
```

相同并发数，**内存减少 4 倍**。在 32 GB 的 CI 机器上，Playwright 最多 8 个 worker，kaze 可以运行 80 个以上。

---

## 基准测试

> 本地文件（file:// URL），MacBook Air M1，16 GB 内存

| 测试数 | Playwright | kaze | 速度提升 |
|--------|-----------|------|---------|
| 5 | 942 ms | **447 ms** | 快 2.1× |
| 20 | 2178 ms | **1785 ms** | 快 1.2× |
| 50 | 5111 ms | **4482 ms** | 快 1.1× |

在包含网络请求和服务端渲染的真实 E2E 测试中，kaze 的并行优势会进一步放大。

---

## 为什么更快

kaze 通过三个技术决策实现速度优势：

**1. 多路复用 CDP 会话** — 每个浏览器进程只用一个 WebSocket，通过 `sessionId` 路由所有页面命令。消除了朴素 CDP 实现中每页 ~540 ms 的连接开销。

**2. 原地上下文重置** — 不关闭并重建浏览器上下文（~700 ms），而是调用 `Network.clearBrowserCookies`（~4 ms）。无需启动开销，即可实现包括 HttpOnly Cookie 在内的完整隔离。

**3. 上下文预热** — 测试 N 运行期间，kaze 在后台提前重置下一个上下文。测试 N 结束时，一个新鲜的上下文已经就绪，零等待。

---

## 快速开始

```bash
pnpm add -D @midori/kaze tsx
```

```typescript
// tests/login.spec.ts
import { test, expect } from "@midori/kaze"

test("用户可以登录", async (page) => {
  await page.goto("/login")
  await page.fill("#email", "alice@example.com")
  await page.click("#submit")
  await expect(page).toHaveURL("/dashboard")
  await expect(page.locator("h1")).toHaveText("欢迎，Alice")
})
```

```bash
npx kaze
```

无需配置，即可运行。

---

## 从 Playwright 迁移

### 第一步 — 安装

```bash
pnpm add -D @midori/kaze tsx
pnpm remove @playwright/test   # 可选
```

### 第二步 — 修改导入和参数写法

95% 的测试只需要这一处改动：

```diff
- import { test, expect } from "@playwright/test"
+ import { test, expect } from "@midori/kaze"

- test("用户可以登录", async ({ page }) => {
+ test("用户可以登录", async (page) => {
    await page.goto("/login")
    await page.fill("#email", "user@example.com")
    await page.click("#submit")
    await expect(page).toHaveURL("/dashboard")
  })
```

### 第三步 — 替换配置文件

```diff
- // playwright.config.ts
+ // kaze.config.ts
- import { defineConfig } from "@playwright/test"
+ import { defineConfig } from "@midori/kaze"

  export default defineConfig({
    testMatch: ["e2e/**/*.spec.ts"],
    timeout: 30_000,
    workers: 4,
  })
```

### 第四步 — 运行

```bash
npx kaze          # 替代 playwright test
npx kaze --watch  # 替代 playwright test --ui
```

### 有什么变化

| Playwright | kaze |
|------------|------|
| `async ({ page })` | `async (page)` — 无解构 |
| `@playwright/test` | `@midori/kaze` |
| `playwright.config.ts` | `kaze.config.ts` |
| `test.use({ baseURL })` | 环境变量或手动拼接 URL |

### 暂不支持的功能

| 功能 | 状态 |
|------|------|
| `page.getByRole()` / `getByText()` | ❌ 使用 `page.locator()` |
| `test.use({ storageState })` | ❌ 用 `beforeEach` + `page.evaluate` 替代 |
| Firefox / WebKit | ❌ 仅支持 Chromium |
| `test.step()` | ❌ 未实现 |
| `page.waitForNavigation()` | ❌ 使用 `page.waitForURL()` |

### 使用 compat shim 渐进式迁移

如果你有大量现有测试，可以使用 `compat/shim.mjs` 进行渐进式迁移，
无需修改 `async ({ page }) => {}` 的写法：

```diff
- import { test, expect } from "@playwright/test"
+ import { test, expect } from "./playwright-compat.mjs"

# 代码保持不变 — { page } 解构依然有效
test("现有测试", async ({ page }) => {   // ← 无需修改！
  await page.goto("/")
})
```

```bash
KAZE_BASE_URL=http://localhost:3000 npx kaze tests/
```

> 完整兼容性表请参阅 [`docs/playwright-compat.md`](docs/playwright-compat.md)。

---

## API 参考

### `test()`

```typescript
test(name, async (page) => { ... })
test.only(name, fn)          // 只运行此测试
test.skip(name, fn)          // 跳过此测试
test.retry(n)(name, fn)      // 失败时最多重试 n 次
```

### 生命周期钩子

```typescript
import { beforeAll, afterAll, beforeEach, afterEach } from "@midori/kaze"

beforeAll(async () => { /* describe 内所有测试前执行一次 */ })
afterAll(async () => { /* describe 内所有测试后执行一次 */ })
beforeEach(async () => { /* 每个测试前 */ })
afterEach(async () => { /* 每个测试后 */ })
```

### `page`

```typescript
page.goto(url, { timeout? })
page.waitForURL(url)              // 字符串 | RegExp | glob
page.waitForLoadState(state)      // "load" | "domcontentloaded" | "networkidle"
page.click(selector, { timeout? })
page.fill(selector, value, { timeout? })
page.keyboard.press("Enter")
page.title()
page.screenshot()                 // → Buffer

// 网络拦截
page.route(pattern, handler)
page.unroute(pattern)
```

### `locator`

```typescript
const el = page.locator(selector)

// 操作（默认自动重试 30 秒）
el.click()  el.fill(value)  el.hover()
el.check()  el.uncheck()  el.selectOption(value)

// 读取（带自动重试）
el.textContent()   // 含隐藏节点
el.innerText()     // 仅可见文本
el.getAttribute(name)  el.inputValue()

// 读取（立即返回，不重试）
el.isVisible()  el.isEnabled()  el.count()  el.all()
```

### `expect()`

```typescript
expect(page).toHaveURL(url)
expect(page).toHaveTitle(title)
expect(el).toHaveText(text)
expect(el).toBeVisible()  expect(el).toBeEnabled()
expect(el).toBeDisabled() expect(el).toBeChecked()
expect(el).toHaveValue(value)
expect(el).toHaveCount(n)
```

---

## CLI

```bash
kaze                       # 运行所有 *.spec.{ts,js}
kaze src/features/         # 指定目录
kaze --workers=50          # 并发上下文数
kaze --watch               # 监听模式
kaze --grep="登录"         # 按名称过滤
kaze --retries=2           # 失败重试次数
kaze --shard=1/4           # CI 分片
kaze --reporter=html       # 生成 HTML 报告
kaze --screenshot=off      # 禁用截图
```

---

## 配置文件

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
  prewarm: true,          // 上下文预热（默认开启）
  shard: "1/4",
})
```

---

## CI 分片

```yaml
jobs:
  e2e:
    strategy:
      matrix:
        shard: ["1/4", "2/4", "3/4", "4/4"]
    steps:
      - run: npx kaze --shard=${{ matrix.shard }} --workers=20
```

4 个分片 × 20 个 worker = 单台 16 GB 机器上的 **80 并发上下文**。

### 大规模内存对比

| 并发数 | kaze | Playwright |
|--------|------|-----------|
| 20 | ~1.7 GB | ~6.8 GB |
| 100 | ~8.3 GB | ~34.2 GB |
| 300 | ~24.9 GB | ~102.5 GB |

---

## 架构说明

**为什么使用 Chrome DevTools Protocol（CDP）？**

CDP 是本地自动化访问 Chromium 的最低延迟路径。WebDriver BiDi（W3C 标准）专为远程/跨浏览器场景设计，2026 年仍不完整。当 BiDi 的 `Network.intercept` 等功能成熟后，kaze 将迁移到 BiDi，届时将支持 Firefox。

---

## 许可证

MIT © Midori Takahashi
