/**
 * 大規模テストスイートのベンチマーク
 * 1000テストを想定し、並列数を変えて Playwright と比較
 */
import { chromium } from "@playwright/test";
import { performance } from "node:perf_hooks";
import { BrowserPool } from "../src/pool/BrowserPool.js";
import { Scheduler } from "../src/scheduler/Scheduler.js";
import { test as kazeTest, collectTestCases, _resetRegistry } from "../src/api/test.js";

const FIXTURE = new URL("../examples/fixtures/index.html", import.meta.url).href;
const TEST_COUNT = 200; // 200テストで計測（1000の縮小版）

function fmt(ms: number, n: number): string {
  return `${ms.toFixed(0)}ms (${(ms/n).toFixed(0)}ms/test)`;
}

// Playwright: N parallel workers
async function benchPlaywright(parallel: number): Promise<number> {
  const browser = await chromium.launch({ headless: true });
  const t0 = performance.now();
  let done = 0;
  while (done < TEST_COUNT) {
    const batch = Math.min(parallel, TEST_COUNT - done);
    await Promise.all(Array.from({ length: batch }, async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(FIXTURE);
      await page.click("#btn");
      await page.textContent("#result");
      await ctx.close();
    }));
    done += batch;
  }
  const ms = performance.now() - t0;
  await browser.close();
  return ms;
}

// kaze: N workers via BrowserPool
async function benchKaze(parallel: number): Promise<number> {
  const pool = new BrowserPool();
  await pool.init({ workers: parallel });
  const actual = pool.stats().totalContexts;

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
  const results = await scheduler.run();
  const ms = performance.now() - t0;

  const failed = results.filter(r => r.status !== "passed").length;
  if (failed > 0) console.warn(`  ⚠ ${failed} failed`);
  process.stdout.write(` [actual: ${actual}ctx] `);

  await pool.close();
  return ms;
}

console.log(`\n=== 大規模テストベンチマーク (${TEST_COUNT} tests) ===`);
console.log("※ このマシンでの結果。CI(大メモリ)ではさらに並列数が増加する\n");
console.log(`  ${"parallel".padEnd(10)} | ${"Playwright".padStart(20)} | ${"kaze".padStart(20)} | 速度比`);
console.log("  " + "-".repeat(70));

for (const parallel of [10, 20, 50]) {
  process.stdout.write(`  ${String(parallel).padEnd(10)} | `);

  const pw = await benchPlaywright(parallel);
  process.stdout.write(`${fmt(pw, TEST_COUNT).padStart(20)} | `);

  const kz = await benchKaze(parallel);
  process.stdout.write(`${fmt(kz, TEST_COUNT).padStart(20)} | `);

  const ratio = (pw / kz).toFixed(2);
  const winner = kz < pw ? `${ratio}x kaze ✓` : `${(kz/pw).toFixed(2)}x Playwright ✓`;
  console.log(winner);

  await new Promise<void>(r => setTimeout(r, 1000));
}

console.log("\n--- CI シミュレーション (KAZE_WORKERS env) ---");
console.log("CI環境では KAZE_WORKERS=N で並列数を指定。Playwrightは --workers=N で同等設定\n");
console.log(`${"KAZE_WORKERS".padEnd(15)} → processCount × ctxPerProc = total`);
for (const w of [10, 20, 50, 100, 300]) {
  const processes = Math.ceil(w / 10);
  const contexts = 10;
  const ram = processes * 350 + w * 50;
  console.log(`  ${String(w).padStart(4)}              → ${processes} × ${contexts} = ${w} parallel  (RAM: ~${(ram/1024).toFixed(1)}GB)`);
}
console.log(`\n  Playwright 同等 (--workers=N):`);
for (const w of [10, 20, 50, 100, 300]) {
  const ram = w * 350;
  console.log(`  ${String(w).padStart(4)} workers         → ${w} プロセス  (RAM: ~${(ram/1024).toFixed(1)}GB)`);
}
console.log("\n=== 完了 ===\n");

// Force-exit so lingering processes don't keep Node alive
process.exit(0);
