# kaze

Playwright-less browser automation toolkit.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- [pnpm](https://pnpm.io/) >= 9

### Setup

```bash
pnpm install
```

### Available Commands

| Command             | Description                                   |
| ------------------- | --------------------------------------------- |
| `pnpm build`        | Build to `dist/` with type definitions (tsup) |
| `pnpm typecheck`    | Run TypeScript type check                     |
| `pnpm test`         | Run tests once (Vitest)                       |
| `pnpm test:watch`   | Run tests in watch mode                       |
| `pnpm lint`         | Run ESLint                                    |
| `pnpm lint:fix`     | Run ESLint with auto-fix                      |
| `pnpm format`       | Format with Prettier                          |
| `pnpm format:check` | Check formatting with Prettier                |

### Quick Start

```bash
pnpm install && pnpm test
```

## 設定ファイル (kaze.config.ts)

プロジェクトルートに `kaze.config.ts` を作成すると設定を永続化できます。

```typescript
import { defineConfig } from "kaze"
export default defineConfig({
  workers: 20,
  timeout: 60000,
  reporter: "dot",
  testMatch: ["src/**/*.spec.ts"],
  screenshot: true,
})
```

| フィールド | 型 | デフォルト | 説明 |
| ---------- | -- | ---------- | ---- |
| `workers` | `number` (正の整数) | システム依存 | 並列ワーカー数 |
| `timeout` | `number` (正の整数, ms) | `30000` | テストごとのタイムアウト |
| `reporter` | `"verbose" \| "dot" \| "html"` | `"verbose"` | 出力フォーマット |
| `prewarm` | `boolean` | `true` | Context をリリース後に即リセット開始してテスト間の待機時間をゼロに近づける |
| `testMatch` | `string[]` | 自動検出 | 実行対象のグロブパターン |
| `screenshot` | `boolean` | `true` | 失敗・タイムアウト時のスクリーンショット |
| `grep` | `string` | — | テスト名の正規表現フィルタ |
| `grepInvert` | `string` | — | テスト名の除外フィルタ |
| `shard` | `string \| { index: number; total: number }` | — | CI 並列実行用シャード指定 (例: `"1/4"`) |

CLI フラグは常に設定ファイルより優先されます。例: 設定に `screenshot: false` があっても `kaze --screenshot=on` で有効化できます。

`--output-dir` フラグを指定すると、HTML レポーターの出力先ディレクトリを変更できます（デフォルト: `.kaze/report/`）。例: `kaze --reporter=html --output-dir=./reports`

## CI でのシャーディング

複数マシンにテストを分散実行できます:

```yaml
# .github/workflows/test.yml
jobs:
  test:
    strategy:
      matrix:
        shard: ["1/4", "2/4", "3/4", "4/4"]
    steps:
      - run: npx kaze --shard=${{ matrix.shard }}
```

`--shard` と `--watch` は同時に使用できません。

## スクリーンショット

テストが失敗・タイムアウトすると自動で `.kaze/screenshots/` に保存されます。
`kaze --screenshot=off` で無効化できます。
`.kaze/` は `.gitignore` に含まれています。

## License

MIT
