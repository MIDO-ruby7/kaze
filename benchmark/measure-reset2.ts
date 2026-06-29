import { createAdapter } from "../src/protocol/index.js";
import { performance } from "node:perf_hooks";

const adapter = createAdapter({ protocol: "cdp" });
await adapter.launch();
const ctx = await adapter.newContext();

const t = (label: string) => {
  const t0 = performance.now();
  return () => console.log(`  ${label}: ${Math.round(performance.now() - t0)}ms`);
};

// Navigate to a real page first
await adapter.navigate(ctx, "about:blank");

console.log("Individual reset steps:");

// Measure clearBrowserCookies
let done = t("Network.clearBrowserCookies");
// Access internal session to test directly
const a = adapter as unknown as { getSession: (id: string) => { send: (m: string, p?: object) => Promise<unknown>; waitForEvent: (m: string) => Promise<unknown> } };
const session = a.getSession(ctx);
await session.send("Network.clearBrowserCookies");
done();

// Measure clearDataForOrigin
done = t("Storage.clearDataForOrigin");
await session.send("Storage.clearDataForOrigin", {
  origin: "*",
  storageTypes: "indexeddb,local_storage,service_workers,cache_storage",
});
done();

// Measure navigate to about:blank
done = t("Page.navigate + loadEventFired");
const loadFired = session.waitForEvent("Page.loadEventFired");
await session.send("Page.navigate", { url: "about:blank" });
await loadFired;
done();

await adapter.closeContext(ctx);
await adapter.close();
