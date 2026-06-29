/**
 * Basic E2E example using the kaze Playwright-compatible API.
 *
 * AC-5: goto → click → expect(toHaveText) via local HTML fixture.
 *       Skipped if Chromium is not installed.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect as vitestExpect } from "vitest";

import { test, expect, collectTestCases } from "../src/index.js";
import { BrowserPool } from "../src/pool/BrowserPool.js";
import { createAdapter } from "../src/protocol/index.js";
import { Scheduler } from "../src/scheduler/Scheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Skip if Chromium is not installed
// ---------------------------------------------------------------------------

function isChromiumInstalled(): boolean {
  const browsersDir = path.join(os.homedir(), ".kaze", "browsers");
  if (!fs.existsSync(browsersDir)) return false;
  const entries = fs.readdirSync(browsersDir);
  return entries.some((e) => e.startsWith("chromium-"));
}

const fixtureUrl = `file://${path.join(__dirname, "fixtures", "index.html")}`;

// ---------------------------------------------------------------------------
// Tests registered via kaze test API
// ---------------------------------------------------------------------------

test.describe("basic fixture", () => {
  test("goto → click → toHaveText", async (page) => {
    await page.goto(fixtureUrl);

    // Initial state
    await expect(page.locator("#result")).toHaveText("waiting");

    // Click the button
    await page.click("#btn");

    // Text should change to "done"
    await expect(page.locator("#result")).toHaveText("done");
  });

  test("fill changes echo text", async (page) => {
    await page.goto(fixtureUrl);
    await page.fill("#input", "hello kaze");
    await expect(page.locator("#echo")).toHaveText("hello kaze");
  });
});

// ---------------------------------------------------------------------------
// Vitest integration: run the registered tests through Scheduler
// ---------------------------------------------------------------------------

describe("examples/basic.spec.ts", () => {
  it.skipIf(!!process.env.KAZE_SKIP_E2E || !isChromiumInstalled())("runs kaze tests against the fixture page", async () => {
    const adapter = createAdapter({ protocol: "cdp" });
    const pool = new BrowserPool();

    try {
      await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1 });

      const scheduler = new Scheduler(pool);
      const cases = collectTestCases(adapter);
      scheduler.enqueue(cases);

      const results = await scheduler.run();

      for (const r of results) {
        vitestExpect(r.status, `${r.name}: ${r.error ?? ""}`).toBe("passed");
      }
    } finally {
      await pool.close?.().catch(() => {});
    }
  }, 60_000);
});
