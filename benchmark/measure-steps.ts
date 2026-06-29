import { createAdapter } from "../src/protocol/index.js";
import { performance } from "node:perf_hooks";

const adapter = createAdapter({ protocol: "cdp" });
await adapter.launch();

const t = (label: string) => {
  const t0 = performance.now();
  return () => console.log(`${label}: ${Math.round(performance.now() - t0)}ms`);
};

// measure newContext
let done = t("newContext");
const ctx1 = await adapter.newContext();
done();

// measure closeContext
done = t("closeContext");
await adapter.closeContext(ctx1);
done();

// measure newContext again (warmed up)
done = t("newContext (2nd)");
const ctx2 = await adapter.newContext();
done();

await adapter.closeContext(ctx2);
await adapter.close();
