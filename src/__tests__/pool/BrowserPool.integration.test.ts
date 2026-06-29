/**
 * Integration tests for BrowserPool — requires a real Chromium installation.
 *
 * AC-6: 8 concurrent acquire/release × 50 rounds — no leak or deadlock.
 * Skipped automatically when Chromium is not installed.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { BrowserPool } from "../../pool/BrowserPool.js";

// ---------------------------------------------------------------------------
// Skip guard: detect whether any chromium-* dir exists under ~/.kaze/browsers
// ---------------------------------------------------------------------------

function isChromiumInstalled(): boolean {
  const browsersDir = path.join(os.homedir(), ".kaze", "browsers");
  if (!fs.existsSync(browsersDir)) return false;
  const entries = fs.readdirSync(browsersDir, { withFileTypes: true });
  return entries.some((e) => e.isDirectory() && e.name.startsWith("chromium-"));
}

const describeOrSkip =
  process.env.KAZE_SKIP_E2E || !isChromiumInstalled() ? describe.skip : describe;

// ---------------------------------------------------------------------------
// AC-6: integration stress test
// ---------------------------------------------------------------------------

describeOrSkip("AC-6: BrowserPool integration (real Chromium)", () => {
  it(
    "8 concurrent acquire/release × 50 rounds — no leak or deadlock",
    async () => {
      const CONCURRENCY = 8;
      const ROUNDS = 50;

      const pool = new BrowserPool();
      // Use small sizing to keep the test fast
      await pool.init({ maxProcesses: 2, maxContextsPerProcess: 4, basePort: 9400 });

      const doRound = async (): Promise<void> => {
        const ctx = await pool.acquire();
        // Minimal real work: just evaluate a trivial expression
        // (we do NOT navigate to avoid network dependency)
        pool.release(ctx);
      };

      for (let round = 0; round < ROUNDS; round++) {
        await Promise.all(Array.from({ length: CONCURRENCY }, () => doRound()));
      }

      const s = pool.stats();
      expect(s.busy).toBe(0);
      expect(s.idle).toBe(s.totalContexts);

      await pool.close();
    },
    120_000,
  );
});
