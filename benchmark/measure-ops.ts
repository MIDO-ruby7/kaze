/**
 * テスト1件の各操作にかかる時間を計測する
 */
import { performance } from "node:perf_hooks";
import { BrowserPool } from "../src/pool/BrowserPool.js";
import { createPage } from "../src/api/Page.js";

const FIXTURE = new URL("../examples/fixtures/index.html", import.meta.url).href;

const pool = new BrowserPool();
await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1 });

const ctx = await pool.acquire();
const adapter = pool.getAdapter(ctx.adapterId);
const page = createPage(adapter, ctx);

const t = (label: string) => {
  const t0 = performance.now();
  return () => `${label}: ${Math.round(performance.now() - t0)}ms`;
};

// warmup
await page.goto(FIXTURE);

const results: string[] = [];

for (let i = 0; i < 5; i++) {
  const r: string[] = [];
  let done = t("goto");
  await page.goto(FIXTURE);
  r.push(done());

  done = t("click");
  await page.click("#btn");
  r.push(done());

  done = t("textContent");
  await page.textContent("#result");
  r.push(done());

  done = t("reset");
  await adapter.resetContext!(ctx.contextId);
  r.push(done());

  results.push(r.join(" | "));
}

console.log("Per-operation timing (5 runs):");
results.forEach((r, i) => console.log(`  [${i+1}] ${r}`));

pool.release(ctx);
await pool.close();

// Force-exit so lingering processes don't keep Node alive
process.exit(0);
