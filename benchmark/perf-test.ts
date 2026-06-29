/**
 * kaze performance measurement script.
 *
 * Measures key operations and writes results to benchmark/perf-results.json.
 *
 * Set KAZE_SKIP_E2E=1 to skip Chromium-dependent sections (CI without browser).
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKIP_E2E = process.env.KAZE_SKIP_E2E === "1";

const FIXTURE_URL = new URL("../examples/fixtures/index.html", import.meta.url).href;

function getGitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function avg(fn: () => Promise<number>, runs: number): Promise<number> {
  let total = 0;
  for (let i = 0; i < runs; i++) {
    total += await fn();
  }
  return total / runs;
}

// ---------------------------------------------------------------------------
// Unit operation measurements (require real Chromium)
// ---------------------------------------------------------------------------

async function measureUnitOps(): Promise<{
  contextReset_ms: number;
  navigate_ms: number;
  evaluate_ms: number;
  newContext_ms: number;
}> {
  const { createAdapter } = await import("../src/protocol/index.js");

  const adapter = createAdapter({ protocol: "cdp" });
  await adapter.launch();

  const ctx = await adapter.newContext();

  // Warm up
  await adapter.navigate(ctx, FIXTURE_URL);

  // contextReset (5 runs average)
  const contextReset_ms = await avg(async () => {
    const t0 = performance.now();
    if (adapter.resetContext) {
      await adapter.resetContext(ctx);
    } else {
      // fallback: close + new context
      await adapter.closeContext(ctx);
      await adapter.newContext();
    }
    return performance.now() - t0;
  }, 5);

  // navigate (5 runs average)
  const navigate_ms = await avg(async () => {
    const t0 = performance.now();
    await adapter.navigate(ctx, FIXTURE_URL);
    return performance.now() - t0;
  }, 5);

  // evaluate (5 runs average)
  const evaluate_ms = await avg(async () => {
    const t0 = performance.now();
    await adapter.evaluate(ctx, "1 + 1");
    return performance.now() - t0;
  }, 5);

  await adapter.closeContext(ctx);

  // newContext (3 runs average)
  const newContext_ms = await avg(async () => {
    const t0 = performance.now();
    const newCtx = await adapter.newContext();
    const elapsed = performance.now() - t0;
    await adapter.closeContext(newCtx);
    return elapsed;
  }, 3);

  await adapter.close();

  return { contextReset_ms, navigate_ms, evaluate_ms, newContext_ms };
}

// ---------------------------------------------------------------------------
// Throughput measurements (require real Chromium)
// ---------------------------------------------------------------------------

async function measureThroughput(count: number): Promise<number> {
  const { BrowserPool } = await import("../src/pool/BrowserPool.js");
  const { Scheduler } = await import("../src/scheduler/Scheduler.js");
  const { test: kazeTest, collectTestCases, _resetRegistry } = await import(
    "../src/api/test.js"
  );

  _resetRegistry();
  for (let i = 0; i < count; i++) {
    kazeTest(`perf-test-${i}`, async (page) => {
      await page.goto(FIXTURE_URL);
      await page.evaluate("1 + 1");
    });
  }

  const pool = new BrowserPool();
  await pool.init({ maxProcesses: 1, maxContextsPerProcess: 10 });

  const scheduler = new Scheduler(pool);
  const cases = collectTestCases(pool);
  scheduler.enqueue(cases);

  const t0 = performance.now();
  await scheduler.run();
  const totalMs = performance.now() - t0;

  await pool.close();

  return totalMs / count;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("kaze performance measurement");
console.log(`KAZE_SKIP_E2E=${SKIP_E2E ? "1 (skipping Chromium tests)" : "0"}`);
console.log("");

let results: Record<string, number>;

if (SKIP_E2E) {
  console.log("Skipping Chromium-dependent measurements.");
  console.log("Using placeholder values for E2E metrics.");
  results = {
    contextReset_ms: 0,
    navigate_ms: 0,
    evaluate_ms: 0,
    newContext_ms: 0,
    throughput_10_ms_per_test: 0,
    throughput_20_ms_per_test: 0,
  };
} else {
  console.log("Measuring unit operations...");
  const unitOps = await measureUnitOps();
  console.log(`  contextReset: ${unitOps.contextReset_ms.toFixed(1)}ms`);
  console.log(`  navigate:     ${unitOps.navigate_ms.toFixed(1)}ms`);
  console.log(`  evaluate:     ${unitOps.evaluate_ms.toFixed(1)}ms`);
  console.log(`  newContext:   ${unitOps.newContext_ms.toFixed(1)}ms`);

  console.log("\nMeasuring throughput (10 parallel tests)...");
  const tp10 = await measureThroughput(10);
  console.log(`  throughput_10: ${tp10.toFixed(1)}ms/test`);

  console.log("\nMeasuring throughput (20 parallel tests)...");
  const tp20 = await measureThroughput(20);
  console.log(`  throughput_20: ${tp20.toFixed(1)}ms/test`);

  results = {
    contextReset_ms: Math.round(unitOps.contextReset_ms * 10) / 10,
    navigate_ms: Math.round(unitOps.navigate_ms * 10) / 10,
    evaluate_ms: Math.round(unitOps.evaluate_ms * 10) / 10,
    newContext_ms: Math.round(unitOps.newContext_ms * 10) / 10,
    throughput_10_ms_per_test: Math.round(tp10 * 10) / 10,
    throughput_20_ms_per_test: Math.round(tp20 * 10) / 10,
  };
}

const output = {
  timestamp: new Date().toISOString(),
  gitCommit: getGitCommit(),
  results,
};

const outPath = join(__dirname, "perf-results.json");
writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");

console.log(`\nResults written to benchmark/perf-results.json`);
console.log(JSON.stringify(output, null, 2));
