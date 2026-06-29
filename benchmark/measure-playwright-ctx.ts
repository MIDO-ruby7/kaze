/**
 * Playwright の newContext() と newPage() の時間を計測する
 */
import { chromium } from "@playwright/test";
import { performance } from "node:perf_hooks";

const browser = await chromium.launch({ headless: true });

// warm up
const ctx0 = await browser.newContext();
await ctx0.close();

const t = (label: string) => {
  const t0 = performance.now();
  return () => console.log(`  ${label}: ${Math.round(performance.now() - t0)}ms`);
};

console.log("Playwright context/page timing:");

let done = t("browser.newContext()");
const ctx = await browser.newContext();
done();

done = t("ctx.newPage()");
const page = await ctx.newPage();
done();

done = t("page.goto('about:blank')");
await page.goto("about:blank");
done();

done = t("ctx.close()");
await ctx.close();
done();

// Measure reset approach (reuse page, clear state)
const ctx2 = await browser.newContext();
const page2 = await ctx2.newPage();
await page2.goto("about:blank");

done = t("navigate to about:blank (reset)");
await page2.goto("about:blank");
done();

done = t("clear cookies via CDP");
const client = await ctx2.newCDPSession(page2);
await client.send("Network.clearBrowserCookies");
done();

done = t("clear storage via CDP");
await client.send("Storage.clearDataForOrigin", {
  origin: "*",
  storageTypes: "cookies,indexeddb,local_storage,service_workers,cache_storage",
});
done();

await ctx2.close();
await browser.close();
