/**
 * Performance unit test for computePoolSizing.
 *
 * computePoolSizing is a pure function, so it can be measured reliably in CI
 * without a real Chromium instance (KAZE_SKIP_E2E=1 safe).
 */

import { describe, it, expect } from "vitest";
import { computePoolSizing } from "../../pool/sizing.js";
import type { HostResources } from "../../pool/resources.js";

describe("computePoolSizing performance", () => {
  it("computePoolSizing runs in < 1ms per call (1000-iteration average)", () => {
    const resources: HostResources = {
      totalMemMB: 16384,
      freeMemMB: 8192,
      cpuCount: 8,
    };

    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      computePoolSizing(resources);
    }
    const avg = (performance.now() - t0) / 1000;

    expect(avg).toBeLessThan(1); // must complete in < 1ms per call
  });
});
