import { BrowserPool } from "../src/pool/BrowserPool.js";
import { performance } from "node:perf_hooks";

// prewarm ON — measure 2nd acquire (after warm has completed)
const poolOn = new BrowserPool();
await poolOn.init({ maxProcesses: 1, maxContextsPerProcess: 1, prewarm: true });

// Cycle 1: release triggers background prewarm
const ctx1 = await poolOn.acquire();
poolOn.release(ctx1);

// Wait for warm to complete in background
await new Promise((r) => setTimeout(r, 300));

// Cycle 2: acquire from already-warmed context — should be near-instant
const t0 = performance.now();
const ctx2 = await poolOn.acquire();
const elapsedOn = Math.round(performance.now() - t0);
console.log(`acquire from warmed context (prewarm ON):  ${elapsedOn}ms`);
ctx2 && poolOn.release(ctx2);
await poolOn.close();

// prewarm OFF — measure 2nd acquire (cold: must wait for resetContext)
const poolOff = new BrowserPool();
await poolOff.init({ maxProcesses: 1, maxContextsPerProcess: 1, prewarm: false });

// Cycle 1: just acquire and release to mirror the ON path
const ctx3 = await poolOff.acquire();
poolOff.release(ctx3);

// No prewarm runs, but give the same settle time for fairness
await new Promise((r) => setTimeout(r, 300));

// Cycle 2: acquire triggers a full resetContext inline
const t1 = performance.now();
const ctx4 = await poolOff.acquire();
const elapsedOff = Math.round(performance.now() - t1);
console.log(`acquire from cold context  (prewarm OFF): ${elapsedOff}ms`);
ctx4 && poolOff.release(ctx4);
await poolOff.close();

console.log(`prewarm speedup: ${elapsedOff}ms → ${elapsedOn}ms`);

// Force-exit so lingering processes don't keep Node alive
process.exit(0);
