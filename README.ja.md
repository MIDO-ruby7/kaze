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

**E2E テスト。より速く。より軽く。CDP で構築。**

[![npm](https://img.shields.io/npm/v/@midori/kaze?color=0ea5e9&label=%40midori%2Fkaze&style=flat-square)](https://www.npmjs.com/package/@midori/kaze)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-64748b?style=flat-square)](https://nodejs.org/)

[English](README.md) · [中文](README.zh.md)

<br />

</div>

---

## 既存ツールの問題

Playwright で 300 並列テストを実行すると RAM が **約 105 GB** 必要です――ワーカーごとにブラウザプロセスを起動するためです。16 GB の CI マシンでは 8 ワーカーが限界。多くのマシンに分散し、コストをかけ、待ち時間が長くなります。

kaze は**共有ブラウザプール**を使います。少ないプロセスの中に複数のコンテキストを収める設計です。300 並列のコストは **約 25 GB**。

```
Playwright  300 workers = 300 ブラウザプロセス × 350 MB = 105 GB
kaze        300 workers =  30 ブラウザプロセス × 10 コンテキスト = 25 GB
```

**同じ並列数で RAM を 4 分の 1** に削減。32 GB の CI マシンで kaze なら 80 以上の並列実行が可能です。

---

## ベンチマーク

> ローカルファイル（file:// URL）、MacBook Air M1、16 GB RAM

| テスト数 | Playwright | kaze | 速度比 |
|---------|-----------|------|--------|
| 5件 | 942 ms | **447 ms** | 2.1× 速い |
| 20件 | 2178 ms | **1785 ms** | 1.2× 速い |
| 50件 | 5111 ms | **4482 ms** | 1.1× 速い |

ネットワークやサーバーレンダリングを含む実際の E2E テストでは、kaze の並列化優位性がさらに高まります。

---

## なぜ速いのか

kaze は 3 つの技術的な選択で速さを実現しています。

**1. Multiplexed CDP セッション** — ブラウザプロセスごとに 1 つの WebSocket。ページごとに接続を開かず、`sessionId` でルーティングします。素朴な CDP 実装で発生するページごとの ~540 ms オーバーヘッドを排除。

**2. インプレース・コンテキストリセット** — ブラウザコンテキストを閉じて作り直す代わり（~700 ms）、`Network.clearBrowserCookies`（~4 ms）を呼ぶだけ。HttpOnly Cookie を含む完全な Cookie 分離を、起動コストなしで実現。

**3. コンテキストプリウォーミング** — テスト N が実行中、次のコンテキストのリセットをバックグラウンドで先行実行。テスト N が終わったとき、新鮮なコンテキストが即座に使える状態になっています。

---

## クイックスタート

```bash
pnpm add -D @midori/kaze tsx
```

```typescript
// tests/login.spec.ts
import { test, expect } from "@midori/kaze"

test("ユーザーがログインできる", async (page) => {
  await page.goto("/login")
  await page.fill("#email", "alice@example.com")
  await page.click("#submit")
  await expect(page).toHaveURL("/dashboard")
  await expect(page.locator("h1")).toHaveText("ようこそ、Alice")
})
```

```bash
npx kaze
```

設定不要。これだけで動きます。

---

## Playwright から移行する

### ステップ 1 — インストール

```bash
pnpm add -D @midori/kaze tsx
pnpm remove @playwright/test   # 任意
```

### ステップ 2 — import と引数の変更

95% のテストで必要な変更はこれだけです：

```diff
- import { test, expect } from "@playwright/test"
+ import { test, expect } from "@midori/kaze"

- test("ユーザーがログインできる", async ({ page }) => {
+ test("ユーザーがログインできる", async (page) => {
    await page.goto("/login")
    await page.fill("#email", "user@example.com")
    await page.click("#submit")
    await expect(page).toHaveURL("/dashboard")
  })
```

### ステップ 3 — 設定ファイルを置き換える

```diff
- // playwright.config.ts
- import { defineConfig } from "@playwright/test"
+ // kaze.config.ts
+ import { defineConfig } from "@midori/kaze"

  export default defineConfig({
    testMatch: ["e2e/**/*.spec.ts"],
    timeout: 30_000,
    workers: 4,
  })
```

### ステップ 4 — 実行

```bash
npx kaze          # playwright test の代わりに
npx kaze --watch  # playwright test --ui の代わりに
```

### 変わること

| Playwright | kaze |
|------------|------|
| `async ({ page })` | `async (page)` — destructuring なし |
| `@playwright/test` | `@midori/kaze` |
| `playwright.config.ts` | `kaze.config.ts` |
| `test.use({ baseURL })` | 環境変数またはURL手動プレフィックス |

### 未対応機能

| 機能 | 状況 |
|---------|--------|
| `page.getByRole()` / `getByText()` | ❌ `page.locator()` を使う |
| `test.use({ storageState })` | ❌ `beforeEach` + `page.evaluate` で代替 |
| Firefox / WebKit | ❌ Chromium のみ |
| `test.step()` | ❌ 未実装 |
| `page.waitForNavigation()` | ❌ `page.waitForURL()` を使う |

### compat shim で段階的に移行

大量のテストがある場合、`compat/shim.mjs` を使って段階的に移行できます。
`async ({ page }) => {}` のままで動作します：

```diff
- import { test, expect } from "@playwright/test"
+ import { test, expect } from "./playwright-compat.mjs"

# コードはそのまま — { page } の destructuring が動作する
test("既存のテスト", async ({ page }) => {   // ← 変更不要！
  await page.goto("/")
})
```

```bash
KAZE_BASE_URL=http://localhost:3000 npx kaze tests/
```

> 互換性の詳細は [`docs/playwright-compat.md`](docs/playwright-compat.md) を参照してください。

---

## API リファレンス

### `test()`

```typescript
test(name, async (page) => { ... })
test.only(name, fn)          // このテストだけ実行
test.skip(name, fn)          // スキップ
test.retry(n)(name, fn)      // 失敗時に最大 n 回リトライ

test.describe(name, () => {
  test.describe.only(...)
  test.describe.skip(...)
})
```

### ライフサイクルフック

```typescript
import { beforeAll, afterAll, beforeEach, afterEach } from "@midori/kaze"

beforeAll(async () => { /* describe 内の全テストの前に1回 */ })
afterAll(async () => { /* describe 内の全テストの後に1回 */ })
beforeEach(async () => { /* 各テストの前 */ })
afterEach(async () => { /* 各テストの後 */ })
```

### `page`

```typescript
// ナビゲーション
page.goto(url, { timeout? })
page.waitForURL(url)              // 文字列 | RegExp | glob
page.waitForLoadState(state)      // "load" | "domcontentloaded" | "networkidle"
page.title()
page.screenshot()                 // → Buffer

// 操作
page.click(selector, { timeout? })
page.fill(selector, value, { timeout? })
page.keyboard.press("Enter")

// ネットワーク
page.route(pattern, handler)      // リクエストをインターセプト
page.unroute(pattern)
```

### `locator`

```typescript
const el = page.locator(selector)

// アクション — すべてデフォルト30秒間自動リトライ
el.click({ timeout? })
el.fill(value, { timeout? })
el.hover()
el.check()
el.uncheck()
el.selectOption(value)

// 読み取り（自動リトライあり）
el.textContent()      // 非表示ノードを含む
el.innerText()        // 表示テキストのみ
el.getAttribute(name)
el.inputValue()

// 読み取り（即時・リトライなし）
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

// Locator — すべて30秒間自動リトライ
expect(el).toHaveText(text)
expect(el).toBeVisible()
expect(el).toBeEnabled()
expect(el).toBeDisabled()
expect(el).toBeChecked()
expect(el).toHaveValue(value)
expect(el).toHaveCount(n)
```

### ネットワークモック

```typescript
test("バックエンドなしで動作する", async (page) => {
  await page.route("/api/users", (route) => {
    route.fulfill({ json: [{ id: 1, name: "Alice" }] })
  })

  await page.goto("/users")
  await expect(page.locator(".user")).toHaveCount(1)
})
```

---

## CLI

```bash
kaze                       # *.spec.{ts,js} を全て実行
kaze src/features/         # ディレクトリ指定
kaze "**/*.spec.ts"        # glob パターン
kaze --workers=50          # 並列数
kaze --watch               # ウォッチモード
kaze --grep="ログイン"     # テスト名フィルタ
kaze --retries=2           # 失敗時リトライ
kaze --shard=1/4           # CI シャーディング
kaze --reporter=html       # HTML レポート生成
kaze --screenshot=off      # スクリーンショット無効
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
  prewarm: true,          // コンテキストプリウォーミング（デフォルト ON）
  grep: "ログイン",
  shard: "1/4",
})
```

CLI フラグは常に設定ファイルより優先されます。`KAZE_WORKERS=N` 環境変数でも並列数を設定できます。

---

## CI シャーディング

```yaml
jobs:
  e2e:
    strategy:
      matrix:
        shard: ["1/4", "2/4", "3/4", "4/4"]
    steps:
      - run: npx kaze --shard=${{ matrix.shard }} --workers=20
```

4 シャード × 20 ワーカー = 16 GB マシン 1 台で **80 並列コンテキスト**。

### スケール時のメモリ比較

| 並列数 | kaze | Playwright |
|--------|------|-----------|
| 20 | 約 1.7 GB | 約 6.8 GB |
| 100 | 約 8.3 GB | 約 34.2 GB |
| 300 | 約 24.9 GB | 約 102.5 GB |

---

## スクリーンショット & HTML レポート

失敗・タイムアウト時に **自動で** `.kaze/screenshots/` へ保存されます。

```bash
kaze --reporter=html      # .kaze/report/index.html を生成
kaze --screenshot=off     # スクリーンショット無効
```

`.kaze/` は `.gitignore` に含まれています。

---

## アーキテクチャ

```
kaze CLI (bin/kaze.js)
  └─ tsx ローダー  ←  TypeScript スペックファイル
      └─ Scheduler  ←  失敗優先キュー、リトライ
          └─ BrowserPool  ←  N プロセス × M コンテキスト
              └─ CdpAdapter  ←  多重化 WebSocket セッション
                  └─ Chromium（ヘッドレス）
```

**なぜ Chrome DevTools Protocol（CDP）なのか？**
CDP はローカル自動化において Chromium への最低レイテンシな経路です。WebDriver BiDi（W3C 標準）はリモート/クロスブラウザ向けに設計されており、2026 年現在はまだ機能が不完全です。BiDi の `Network.intercept` 等が成熟した時点で kaze も移行し、Firefox サポートを実現する予定です。

---

## ライセンス

MIT © Midori Takahashi
