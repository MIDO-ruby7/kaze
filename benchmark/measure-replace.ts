import { BrowserPool } from "../src/pool/BrowserPool.js";
import { performance } from "node:perf_hooks";

// prewarm ON（デフォルト）
const poolOn = new BrowserPool();
await poolOn.init({ maxProcesses: 1, maxContextsPerProcess: 1, prewarm: true });
const ctxOn = await poolOn.acquire();
const t0 = performance.now();
poolOn.release(ctxOn);
const warmCtx = await poolOn.acquire(); // should be fast
const elapsedOn = Math.round(performance.now() - t0);
console.log(`context replacement (prewarm ON):  ${elapsedOn}ms`);
warmCtx && poolOn.release(warmCtx);
await poolOn.close();

// prewarm OFF（比較用）
const poolOff = new BrowserPool();
await poolOff.init({ maxProcesses: 1, maxContextsPerProcess: 1, prewarm: false });
const ctxOff = await poolOff.acquire();
const t1 = performance.now();
poolOff.release(ctxOff);
const coldCtx = await poolOff.acquire(); // waits for resetContext
const elapsedOff = Math.round(performance.now() - t1);
console.log(`context replacement (prewarm OFF): ${elapsedOff}ms`);
coldCtx && poolOff.release(coldCtx);
await poolOff.close();

console.log(`prewarm speedup: ${elapsedOff}ms → ${elapsedOn}ms`);

// Force-exit so lingering processes don't keep Node alive
process.exit(0);
