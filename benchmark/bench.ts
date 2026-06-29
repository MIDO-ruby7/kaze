/**
 * kaze vs Playwright ベンチマーク
 *
 * 同一シナリオ（goto → click → textContent × N テスト）を
 * kaze と Playwright で比較する。
 *
 * 各ツールは1インスタンスのみ起動し、全テスト数を順に計測する。
 */

import { chromium } from "@playwright/test";
import { performance } from "node:perf_hooks";
import { BrowserPool } from "../src/pool/BrowserPool.js";
import { Scheduler } from "../src/scheduler/Scheduler.js";
import { test as kazeTest, collectTestCases, _resetRegistry } from "../src/api/test.js";

const FIXTURE_URL = new URL("../examples/fixtures/index.html", import.meta.url).href;
const TEST_COUNTS = [5, 20, 50];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(ms: number): string {
  return `${ms.toFixed(0)}ms`;
}

// ---------------------------------------------------------------------------
// Playwright benchmark — one browser, multiple runs
// ---------------------------------------------------------------------------

async function benchPlaywright(): Promise<Map<number, number>> {
  console.log("  [Playwright] ブラウザ起動中...");
  const browser = await chromium.launch({ headless: true });
  const results = new Map<number, number>();

  for (const count of TEST_COUNTS) {
    const t0 = performance.now();
    await Promise.all(
      Array.from({ length: count }, async () => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto(FIXTURE_URL);
        await page.click("#btn");
        await page.textContent("#result");
        await ctx.close();
      }),
    );
    results.set(count, performance.now() - t0);
    console.log(`  [Playwright] ${count} tests: ${fmt(results.get(count)!)}`);
  }

  await browser.close();
  return results;
}

// ---------------------------------------------------------------------------
// kaze benchmark — one pool, multiple runs
// ---------------------------------------------------------------------------

async function benchKaze(): Promise<Map<number, number>> {
  console.log("  [kaze]       プール起動中...");
  const pool = new BrowserPool();
  await pool.init();
  const stats = pool.stats();
  console.log(
    `  [kaze]       pool: ${stats.processes} processes × ${stats.totalContexts / stats.processes} contexts = ${stats.totalContexts} parallel`,
  );

  const results = new Map<number, number>();

  for (const count of TEST_COUNTS) {
    _resetRegistry();
    for (let i = 0; i < count; i++) {
      kazeTest(`test-${i}`, async (page) => {
        await page.goto(FIXTURE_URL);
        await page.click("#btn");
        await page.textContent("#result");
      });
    }

    const scheduler = new Scheduler(pool);
    const cases = collectTestCases(pool);
    scheduler.enqueue(cases);

    const t0 = performance.now();
    const runResults = await scheduler.run();
    results.set(count, performance.now() - t0);

    const failed = runResults.filter((r) => r.status !== "passed");
    if (failed.length > 0) {
      console.warn(`  ⚠ ${failed.length} tests failed`);
    }
    console.log(`  [kaze]       ${count} tests: ${fmt(results.get(count)!)}`);
  }

  await pool.close();
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("\n=== kaze vs Playwright ベンチマーク ===");
console.log(`fixture: ${FIXTURE_URL}\n`);

const pw = await benchPlaywright();
console.log("");
const kz = await benchKaze();

console.log("\n--- 結果 ---");
console.log(`  ${"tests".padStart(8)} | ${"Playwright".padStart(12)} | ${"kaze".padStart(10)} | ${"速度比".padStart(8)}`);
console.log("  " + "-".repeat(52));

for (const count of TEST_COUNTS) {
  const pwMs = pw.get(count)!;
  const kzMs = kz.get(count)!;
  const ratio = (pwMs / kzMs).toFixed(2);
  const winner = kzMs < pwMs ? "kaze ✓" : "Playwright ✓";
  console.log(
    `  ${String(count).padStart(8)} | ${fmt(pwMs).padStart(12)} | ${fmt(kzMs).padStart(10)} | ${ratio}x ${winner}`,
  );
}

console.log("\n=== 完了 ===\n");
