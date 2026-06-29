/**
 * 大規模テストスイートのベンチマーク（Playwright との比較）
 * 1000テスト、KAZE_WORKERS で並列数を変えて計測
 */
import { chromium } from "@playwright/test";
import { performance } from "node:perf_hooks";
import { BrowserPool } from "../src/pool/BrowserPool.js";
import { Scheduler } from "../src/scheduler/Scheduler.js";
import { test as kazeTest, collectTestCases, _resetRegistry } from "../src/api/test.js";

const FIXTURE = new URL("../examples/fixtures/index.html", import.meta.url).href;
const TEST_COUNT = 100; // 100テストで計測（1000は時間がかかりすぎる）

function fmt(ms: number): string { return `${ms.toFixed(0)}ms`; }

// ---------------------------------------------------------------------------
// Playwright benchmark with N workers
// ---------------------------------------------------------------------------
async function benchPlaywright(workers: number): Promise<number> {
  const browser = await chromium.launch({ headless: true });
  const t0 = performance.now();

  // Playwright: N contexts in parallel (simulates --workers=N)
  let completed = 0;
  const runBatch = async (): Promise<void> => {
    while (completed < TEST_COUNT) {
      const batch = Math.min(workers, TEST_COUNT - completed);
      await Promise.all(Array.from({ length: batch }, async () => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto(FIXTURE);
        await page.click("#btn");
        await page.textContent("#result");
        await ctx.close();
      }));
      completed += batch;
    }
  };
  await runBatch();

  const elapsed = performance.now() - t0;
  await browser.close();
  return elapsed;
}

// ---------------------------------------------------------------------------
// kaze benchmark with N workers
// ---------------------------------------------------------------------------
async function benchKaze(workers: number): Promise<number> {
  const pool = new BrowserPool();
  await pool.init({ workers });
  const { totalParallel } = pool.stats() as { totalParallel?: number } & ReturnType<typeof pool.stats>;
  process.stdout.write(`    kaze ${workers}w (${pool.stats().totalContexts} ctx): `);

  _resetRegistry();
  for (let i = 0; i < TEST_COUNT; i++) {
    kazeTest(`t${i}`, async (page) => {
      await page.goto(FIXTURE);
      await page.click("#btn");
      await page.textContent("#result");
    });
  }

  const scheduler = new Scheduler(pool);
  const cases = collectTestCases(pool);
  scheduler.enqueue(cases);

  const t0 = performance.now();
  await scheduler.run();
  const elapsed = performance.now() - t0;

  await pool.close();
  return elapsed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log(`\n=== 大規模テストベンチマーク (${TEST_COUNT} tests) ===\n`);

const workerCounts = [10, 20, 50];

for (const workers of workerCounts) {
  console.log(`[${workers} workers]`);

  const pwTime = await benchPlaywright(workers);
  console.log(`    Playwright ${workers}w: ${fmt(pwTime)}`);

  const kzTime = await benchKaze(workers);
  console.log(`${fmt(kzTime)}`);

  const ratio = (pwTime / kzTime).toFixed(2);
  const winner = kzTime < pwTime ? "✓ kaze 速い" : "Playwright 速い";
  console.log(`    速度比: ${ratio}x ${winner}`);
  console.log("");

  await new Promise<void>(r => setTimeout(r, 1000));
}

console.log("=== 完了 ===\n");
