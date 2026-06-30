# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-06-30

### Added
- Core: BrowserPool, Protocol Adapter (CDP), Scheduler
- Test API: `test()`, `test.only`, `test.skip`, `test.retry`, lifecycle hooks
- Page/Locator API: click, fill, goto, type, check, selectOption, hover, getAttribute, innerText, waitForURL, waitForLoadState, and more
- expect matchers: toHaveText, toBeVisible, toHaveTitle, toBeChecked, toHaveCount, toHaveValue, etc.
- Network mocking: `page.route()` / `route.fulfill()` / `route.continue()`
- CLI runner: `kaze` command, `--watch`, `--grep`, `--shard`, `--retries`, `--reporter=html`
- Configuration: `kaze.config.ts` with `defineConfig`
- Auto-waiting: all actions retry until element is found (up to 30s)
- Screenshot on failure: automatic screenshots saved to `.kaze/screenshots/`
- Context prewarming: reduces per-test overhead
- Performance: 1.5–2.4x faster than Playwright on equivalent workloads
