<div align="center">

# kaze 风

**基于 Chrome DevTools Protocol 构建的高速、完全隔离的 E2E 测试框架**

[![npm](https://img.shields.io/npm/v/@midori/kaze?color=0ea5e9&label=%40midori%2Fkaze)](https://www.npmjs.com/package/@midori/kaze)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)

[English](README.md) · [日本語](README.ja.md)

</div>

---

## 为什么选择 kaze？

| | kaze | Playwright |
|---|---|---|
| **速度** | 相同工作负载下快 1.5–2.4 倍 | 基准 |
| **内存（300 并发）** | 约 25 GB | 约 105 GB |
| **测试隔离** | 完全隔离（Cookie、IndexedDB、Service Worker） | 上下文级别 |
| **API** | Playwright 兼容子集 | 完整 |

kaze 使用**共享浏览器池**运行测试——每个进程可管理多个上下文，而不是每个 worker 启动一个浏览器，从而用更少的内存实现更高的并发。

---

## 快速开始

```bash
pnpm add -D @midori/kaze tsx
```

```typescript
// tests/example.spec.ts
import { test, expect } from "@midori/kaze"

test("首页正常加载", async (page) => {
  await page.goto("https://example.com")
  await expect(page.locator("h1")).toHaveText("Example Domain")
})
```

```bash
npx kaze
```

---

## 安装

```bash
npm install -D @midori/kaze tsx
# 或
pnpm add -D @midori/kaze tsx
```

> 运行 TypeScript 规格文件需要 `tsx`（可选 peer dependency）。

---

## 测试 API

```typescript
import { test, expect, beforeEach, afterEach } from "@midori/kaze"

beforeEach(async () => {
  await db.beginTransaction()
})

afterEach(async () => {
  await db.rollback()
})

test("用户可以登录", async (page) => {
  await page.goto("/login")
  await page.fill("#email", "user@example.com")
  await page.fill("#password", "secret")
  await page.click("#submit")
  await expect(page).toHaveURL("/dashboard")
})

// 只运行此测试
test.only("专注此测试", async (page) => { ... })

// 跳过
test.skip("暂时跳过", async (page) => { ... })

// 失败时最多重试 2 次
test.retry(2)("不稳定测试", async (page) => { ... })
```

### 生命周期钩子

| 钩子 | 作用域 |
|------|--------|
| `beforeAll(fn)` | 当前 `describe` 中所有测试运行前执行一次 |
| `afterAll(fn)` | 当前 `describe` 中所有测试运行后执行一次 |
| `beforeEach(fn)` | 作用域内每个测试运行前执行 |
| `afterEach(fn)` | 作用域内每个测试运行后执行 |

---

## Page API

```typescript
await page.goto(url)
await page.waitForURL(url)                  // 字符串 | RegExp | glob
await page.waitForLoadState("networkidle")  // "load" | "domcontentloaded" | "networkidle"
await page.click(selector)
await page.fill(selector, value)
await page.keyboard.press("Enter")
await page.title()
await page.screenshot()                     // → Buffer

// 网络拦截
await page.route("/api/users", (route) => {
  route.fulfill({ json: [{ id: 1, name: "Alice" }] })
})
```

---

## Locator API

```typescript
const btn = page.locator("#submit")

await btn.click()
await btn.fill("值")
await btn.hover()
await btn.check()
await btn.uncheck()
await btn.selectOption("北京")
await btn.textContent()     // 包含隐藏文本
await btn.innerText()       // 仅可见文本
await btn.getAttribute("href")
await btn.inputValue()
await btn.isVisible()       // 立即返回（不重试）
await btn.isEnabled()       // 立即返回（不重试）
await btn.count()
await btn.all()             // → Locator[]
```

---

## 断言

```typescript
await expect(page).toHaveURL("/dashboard")
await expect(page).toHaveTitle("控制台")
await expect(page.locator("h1")).toHaveText("欢迎")
await expect(page.locator("#status")).toBeVisible()
await expect(page.locator("#btn")).toBeEnabled()
await expect(page.locator('[type=checkbox]')).toBeChecked()
await expect(page.locator("input")).toHaveValue("hello")
await expect(page.locator("li")).toHaveCount(5)
```

所有断言默认自动重试最多 30 秒。

---

## CLI

```bash
kaze                      # 运行所有 *.spec.{ts,js}
kaze src/features/        # 指定目录
kaze --watch              # 监听模式
kaze --workers=50         # 并发数
kaze --grep="登录"        # 按名称过滤
kaze --retries=2          # 失败重试次数
kaze --shard=1/4          # CI 分片
kaze --reporter=html      # 生成 HTML 报告
kaze --screenshot=off     # 禁用截图
```

---

## 配置文件

```typescript
// kaze.config.ts
import { defineConfig } from "@midori/kaze"

export default defineConfig({
  workers: 20,
  timeout: 30_000,
  reporter: "verbose",    // "verbose" | "dot" | "html"
  testMatch: ["tests/**/*.spec.ts"],
  screenshot: true,
  retries: 0,
  prewarm: true,          // 在后台预重置上下文，减少测试间等待
  grep: "登录",
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

### 通过 `KAZE_WORKERS` 大规模并发

```bash
KAZE_WORKERS=100 npx kaze   # 10 进程 × 10 上下文 = 100 并发
```

| 并发数 | kaze 内存 | Playwright 内存 |
|--------|-----------|-----------------|
| 20 | 约 1.7 GB | 约 6.8 GB |
| 100 | 约 8.3 GB | 约 34.2 GB |
| 300 | 约 24.9 GB | 约 102.5 GB |

---

## 截图

测试失败或超时时，自动保存截图至 `.kaze/screenshots/`。

```bash
kaze --screenshot=off   # 禁用
```

---

## HTML 报告

```bash
kaze --reporter=html
# 生成 .kaze/report/index.html
```

---

## 许可证

MIT © Midori Takahashi
