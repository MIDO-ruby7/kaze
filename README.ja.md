<div align="center">

# kaze 風

**Chrome DevTools Protocol 上に構築された、高速・完全分離の E2E テストフレームワーク**

[![npm](https://img.shields.io/npm/v/@midori/kaze?color=0ea5e9&label=%40midori%2Fkaze)](https://www.npmjs.com/package/@midori/kaze)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)

[English](README.md) · [中文](README.zh.md)

</div>

---

## なぜ kaze？

| | kaze | Playwright |
|---|---|---|
| **速度** | 同等ワークロードで 1.5〜2.4× 速い | ベースライン |
| **RAM（300 並列）** | 約 25 GB | 約 105 GB |
| **テスト分離** | Cookie・IndexedDB・Service Worker を含む完全分離 | コンテキスト単位 |
| **API** | Playwright 互換サブセット | フルセット |

kaze は**共有ブラウザプール**でテストを実行します。ワーカーごとにブラウザを起動する代わりに、1プロセスで複数のコンテキストを管理するため、少ない RAM でより多くの並列実行が可能です。

---

## クイックスタート

```bash
pnpm add -D @midori/kaze tsx
```

```typescript
// tests/example.spec.ts
import { test, expect } from "@midori/kaze"

test("ホームページが表示される", async (page) => {
  await page.goto("https://example.com")
  await expect(page.locator("h1")).toHaveText("Example Domain")
})
```

```bash
npx kaze
```

---

## インストール

```bash
npm install -D @midori/kaze tsx
# または
pnpm add -D @midori/kaze tsx
```

> TypeScript のスペックファイルを実行するには `tsx` が必要です（optional peer dependency）。

---

## テスト API

```typescript
import { test, expect, beforeEach, afterEach } from "@midori/kaze"

beforeEach(async () => {
  await db.beginTransaction()
})

afterEach(async () => {
  await db.rollback()
})

test("ユーザーがログインできる", async (page) => {
  await page.goto("/login")
  await page.fill("#email", "user@example.com")
  await page.fill("#password", "secret")
  await page.click("#submit")
  await expect(page).toHaveURL("/dashboard")
})

// このテストだけ実行（他はスキップ）
test.only("このテストに集中", async (page) => { ... })

// スキップ
test.skip("一時的にスキップ", async (page) => { ... })

// 失敗時に最大2回リトライ
test.retry(2)("不安定なテスト", async (page) => { ... })
```

### ライフサイクルフック

| フック | スコープ |
|--------|---------|
| `beforeAll(fn)` | 同じ `describe` 内の全テストの前に1回実行 |
| `afterAll(fn)` | 同じ `describe` 内の全テストの後に1回実行 |
| `beforeEach(fn)` | スコープ内の各テストの前に実行 |
| `afterEach(fn)` | スコープ内の各テストの後に実行 |

---

## Page API

```typescript
await page.goto(url)
await page.waitForURL(url)                  // 文字列 | RegExp | glob
await page.waitForLoadState("networkidle")  // "load" | "domcontentloaded" | "networkidle"
await page.click(selector)
await page.fill(selector, value)
await page.keyboard.press("Enter")
await page.title()
await page.screenshot()                     // → Buffer

// ネットワークモック
await page.route("/api/users", (route) => {
  route.fulfill({ json: [{ id: 1, name: "Alice" }] })
})
```

---

## Locator API

```typescript
const btn = page.locator("#submit")

await btn.click()
await btn.fill("値")
await btn.hover()
await btn.check()
await btn.uncheck()
await btn.selectOption("東京")
await btn.textContent()     // 非表示テキストを含む
await btn.innerText()       // 表示テキストのみ
await btn.getAttribute("href")
await btn.inputValue()
await btn.isVisible()       // 即時（リトライなし）
await btn.isEnabled()       // 即時（リトライなし）
await btn.count()
await btn.all()             // → Locator[]
```

---

## アサーション

```typescript
await expect(page).toHaveURL("/dashboard")
await expect(page).toHaveTitle("ダッシュボード")
await expect(page.locator("h1")).toHaveText("ようこそ")
await expect(page.locator("#status")).toBeVisible()
await expect(page.locator("#btn")).toBeEnabled()
await expect(page.locator('[type=checkbox]')).toBeChecked()
await expect(page.locator("input")).toHaveValue("hello")
await expect(page.locator("li")).toHaveCount(5)
```

デフォルトで最大30秒間自動リトライします。

---

## CLI

```bash
kaze                      # *.spec.{ts,js} を全て実行
kaze src/features/        # ディレクトリ指定
kaze --watch              # ウォッチモード
kaze --workers=50         # 並列数
kaze --grep="ログイン"    # テスト名フィルタ
kaze --retries=2          # 失敗時リトライ
kaze --shard=1/4          # CIシャーディング
kaze --reporter=html      # HTMLレポート生成
kaze --screenshot=off     # スクリーンショット無効
```

---

## 設定ファイル

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
  prewarm: true,          // バックグラウンドでコンテキストを事前リセット
  grep: "ログイン",
  shard: "1/4",
})
```

---

## CI でのシャーディング

```yaml
jobs:
  e2e:
    strategy:
      matrix:
        shard: ["1/4", "2/4", "3/4", "4/4"]
    steps:
      - run: npx kaze --shard=${{ matrix.shard }} --workers=20
```

### `KAZE_WORKERS` で大規模並列

```bash
KAZE_WORKERS=100 npx kaze   # 10プロセス × 10コンテキスト = 100並列
```

| 並列数 | kaze RAM | Playwright RAM |
|--------|----------|----------------|
| 20 | 約 1.7 GB | 約 6.8 GB |
| 100 | 約 8.3 GB | 約 34.2 GB |
| 300 | 約 24.9 GB | 約 102.5 GB |

---

## スクリーンショット

失敗・タイムアウト時に自動で `.kaze/screenshots/` に保存されます。

```bash
kaze --screenshot=off   # 無効化
```

---

## HTMLレポーター

```bash
kaze --reporter=html
# .kaze/report/index.html を生成
```

---

## ライセンス

MIT © Midori Takahashi
