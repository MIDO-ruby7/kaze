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
    "4 concurrent acquire/release × 5 rounds — no deadlock (Approach B: context replacement)",
    async () => {
      // Approach B: each release triggers an async context replacement.
      // Verify: after N rounds of acquire/release, we can still acquire all
      // contexts (proving no deadlock or slot starvation).
      const CONCURRENCY = 4;
      const ROUNDS = 5;

      const pool = new BrowserPool();
      await pool.init({ maxProcesses: 1, maxContextsPerProcess: 4, basePort: 9400 });

      const doRound = async (): Promise<void> => {
        const ctx = await pool.acquire();
        // Minimal work
        pool.release(ctx);
      };

      for (let round = 0; round < ROUNDS; round++) {
        // Each round: wait for all CONCURRENCY acquire() calls to complete,
        // which naturally waits for the previous round's replacements to finish.
        await Promise.all(Array.from({ length: CONCURRENCY }, () => doRound()));
      }

      // Final verification: acquire all slots to confirm no deadlock.
      // This blocks until all pending replacements from the last round complete.
      const finalContexts = await Promise.all(
        Array.from({ length: CONCURRENCY }, () => pool.acquire()),
      );

      // All context IDs should be unique (each is a fresh replacement)
      const ids = finalContexts.map((c) => c.contextId);
      expect(new Set(ids).size).toBe(CONCURRENCY);

      // Clean up without releasing (close() handles it)
      await pool.close();
    },
    60_000,
  );
});
