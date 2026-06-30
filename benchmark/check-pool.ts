import { BrowserPool } from "../src/pool/BrowserPool.js";
import { probeHostResources } from "../src/pool/resources.js";
import { computePoolSizing } from "../src/pool/sizing.js";

const resources = probeHostResources();
console.log("resources:", resources);
const sizing = computePoolSizing(resources);
console.log("sizing:", sizing);
const pool = new BrowserPool();
await pool.init();
console.log("pool stats after init:", pool.stats());
await pool.close();

// Force-exit so lingering processes don't keep Node alive
process.exit(0);
