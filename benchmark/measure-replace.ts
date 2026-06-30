import { BrowserPool } from "../src/pool/BrowserPool.js";
import { performance } from "node:perf_hooks";

const pool = new BrowserPool();
await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1 });

const ctx = await pool.acquire();

const t0 = performance.now();
pool.release(ctx);
const ctx2 = await pool.acquire(); // blocks until replacement done
const elapsed = performance.now() - t0;

console.log(`context replacement: ${Math.round(elapsed)}ms`);

pool.release(ctx2);
await pool.close();

// Force-exit so lingering processes don't keep Node alive
process.exit(0);
