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

## スクリーンショット

テストが失敗・タイムアウトすると自動で `.kaze/screenshots/` に保存されます。
`kaze --screenshot=off` で無効化できます。
`.kaze/` は `.gitignore` に含まれています。

## License

MIT
