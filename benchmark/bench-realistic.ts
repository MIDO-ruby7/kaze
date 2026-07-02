/**
 * 現実的なベンチマーク: HTTP サーバー（100ms 遅延）を使用
 * file:// URL の renderer 競合を回避し、同一 worker 数で公平比較
 */
import { chromium } from "@playwright/test";
import { performance } from "node:perf_hooks";
import { BrowserPool } from "../src/pool/BrowserPool.js";
import { Scheduler } from "../src/scheduler/Scheduler.js";
import { test as kazeTest, collectTestCases, _resetRegistry } from "../src/api/test.js";

const BENCH_URL = "http://localhost:7654";
const TEST_COUNTS = [5, 20, 50];
const MAX_WORKERS = 20;

function fmt(ms: number) { return `${ms.toFixed(0)}ms`; }

async function benchPlaywright(count: number): Promise<number> {
  const browser = await chromium.launch({ headless: true });
  const workers = Math.min(count, MAX_WORKERS);
  const t0 = performance.now();
  let done = 0;
  while (done < count) {
    const batch = Math.min(workers, count - done);
    await Promise.all(Array.from({ length: batch }, async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(BENCH_URL);
      await page.click("#btn");
      await page.textContent("#result");
      await ctx.close();
    }));
    done += batch;
  }
  await browser.close();
  return performance.now() - t0;
}

console.log(`\n=== kaze vs Playwright（HTTP 100ms遅延、${MAX_WORKERS}w 上限）===\n`);

// Playwright first
const pwResults = new Map<number, number>();
for (const count of TEST_COUNTS) {
  pwResults.set(count, await benchPlaywright(count));
  console.log(`  [Playwright] ${count} tests: ${fmt(pwResults.get(count)!)}`);
}

console.log();

// kaze: single pool for all runs
const pool = new BrowserPool();
await pool.init({ workers: MAX_WORKERS });
const stats = pool.stats();
console.log(`  [kaze] pool: ${stats.processes} proc × ${stats.totalContexts / stats.processes} ctx = ${stats.totalContexts} parallel`);

const kzResults = new Map<number, number>();
for (const count of TEST_COUNTS) {
  _resetRegistry();
  for (let i = 0; i < count; i++) {
    kazeTest(`t${i}`, async (page) => {
      await page.goto(BENCH_URL);
      await page.click("#btn");
      await page.textContent("#result");
    });
  }
  const scheduler = new Scheduler(pool);
  const cases = collectTestCases(pool);
  scheduler.enqueue(cases);
  const t0 = performance.now();
  await scheduler.run();
  kzResults.set(count, performance.now() - t0);
  console.log(`  [kaze]       ${count} tests: ${fmt(kzResults.get(count)!)}`);
}
await pool.close();

console.log(`\n${"tests".padStart(8)} | ${"Playwright".padStart(12)} | ${"kaze".padStart(10)} | 速度比`);
console.log("  " + "-".repeat(50));
for (const count of TEST_COUNTS) {
  const pw = pwResults.get(count)!;
  const kz = kzResults.get(count)!;
  const ratio = (pw / kz).toFixed(2);
  const winner = kz < pw ? "kaze ✓" : "Playwright ✓";
  console.log(`${String(count).padStart(8)} | ${fmt(pw).padStart(12)} | ${fmt(kz).padStart(10)} | ${ratio}x ${winner}`);
}
console.log("\n=== 完了 ===\n");
process.exit(0);
