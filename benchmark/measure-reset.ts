import { createAdapter } from "../src/protocol/index.js";
import { performance } from "node:perf_hooks";

const adapter = createAdapter({ protocol: "cdp" });
await adapter.launch();
const ctx = await adapter.newContext();

// warm up Network domain
const t = (label: string) => {
  const t0 = performance.now();
  return () => console.log(`  ${label}: ${Math.round(performance.now() - t0)}ms`);
};

console.log("resetContext() breakdown:");

// First reset (cold)
let done = t("resetContext() (1st)");
await adapter.resetContext!(ctx);
done();

// Second reset (warm)
done = t("resetContext() (2nd)");
await adapter.resetContext!(ctx);
done();

// Third reset
done = t("resetContext() (3rd)");
await adapter.resetContext!(ctx);
done();

await adapter.closeContext(ctx);
await adapter.close();
