/**
 * N個の並列テストを実行した場合の時間を計測
 */
import { performance } from "node:perf_hooks";
import { BrowserPool } from "../src/pool/BrowserPool.js";
import { Scheduler } from "../src/scheduler/Scheduler.js";
import { test as kazeTest, collectTestCases, _resetRegistry } from "../src/api/test.js";

const FIXTURE = new URL("../examples/fixtures/index.html", import.meta.url).href;

const pool = new BrowserPool();
await pool.init({ maxProcesses: 1, maxContextsPerProcess: 10 });
console.log("pool stats:", pool.stats());

for (const N of [1, 5, 10, 20]) {
  _resetRegistry();
  for (let i = 0; i < N; i++) {
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
  const ms = Math.round(performance.now() - t0);
  console.log(`  ${N} tests (${N}-parallel): ${ms}ms  (${Math.round(ms/N)}ms/test)`);
}

await pool.close();

// Force-exit so lingering processes don't keep Node alive
process.exit(0);
