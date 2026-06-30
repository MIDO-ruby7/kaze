/**
 * プロセス数 × context数の最適な組み合わせを探す
 */
import { performance } from "node:perf_hooks";
import { BrowserPool } from "../src/pool/BrowserPool.js";
import { Scheduler } from "../src/scheduler/Scheduler.js";
import { test as kazeTest, collectTestCases, _resetRegistry } from "../src/api/test.js";

const FIXTURE = new URL("../examples/fixtures/index.html", import.meta.url).href;
const TEST_COUNT = 20;

const configs = [
  { maxProcesses: 1, maxContextsPerProcess: 5 },
  { maxProcesses: 1, maxContextsPerProcess: 10 },
  { maxProcesses: 2, maxContextsPerProcess: 5 },
  { maxProcesses: 2, maxContextsPerProcess: 10 },
  { maxProcesses: 4, maxContextsPerProcess: 5 },
];

for (const config of configs) {
  const pool = new BrowserPool();
  await pool.init({ ...config, basePort: 9400 });
  const { totalContexts } = pool.stats();

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
  const ms = Math.round(performance.now() - t0);

  console.log(`  ${config.maxProcesses}proc × ${config.maxContextsPerProcess}ctx = ${totalContexts}parallel: ${ms}ms  (${Math.round(ms/TEST_COUNT)}ms/test)`);

  await pool.close();
  await new Promise<void>(r => setTimeout(r, 500)); // let ports release
}

// Force-exit so lingering processes don't keep Node alive
process.exit(0);
