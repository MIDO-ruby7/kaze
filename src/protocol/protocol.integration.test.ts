/**
 * Integration tests for the ProtocolAdapter / CdpAdapter (AC-4).
 *
 * These tests require a headless Chromium binary in ~/.kaze/browsers/.
 * If no browser is found, the suite is skipped so CI can still pass
 * before the browser-downloader step has run.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveChromiumExecutable } from "./CdpAdapter.js";
import type { ProtocolAdapter } from "./ProtocolAdapter.js";

import { createAdapter } from "./index.js";

// ---------------------------------------------------------------------------
// Pre-flight: locate Chromium
// ---------------------------------------------------------------------------

function findInstalledChromiumDir(): string | undefined {
  const root = path.join(os.homedir(), ".kaze", "browsers");
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("chromium-"))
    .map((e) => path.join(root, e.name))
    .sort();
  return dirs[dirs.length - 1];
}

const chromiumDir = findInstalledChromiumDir();

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe.skipIf(!chromiumDir)(
  "CdpAdapter integration (requires installed Chromium)",
  () => {
    let adapter: ProtocolAdapter;

    beforeAll(async () => {
      const executablePath = resolveChromiumExecutable(chromiumDir!);
      adapter = createAdapter({
        protocol: "cdp",
        cdp: { executablePath, port: 19222 },
      });
      await adapter.launch();
    }, 30_000);

    afterAll(async () => {
      await adapter.close();
    }, 10_000);

    it("creates a context", async () => {
      const contextId = await adapter.newContext();
      expect(typeof contextId).toBe("string");
      expect(contextId.length).toBeGreaterThan(0);
      await adapter.closeContext(contextId);
    });

    it("navigates to about:blank", async () => {
      const contextId = await adapter.newContext();
      await expect(adapter.navigate(contextId, "about:blank")).resolves.toBeUndefined();
      await adapter.closeContext(contextId);
    });

    it("evaluates JavaScript and returns a value", async () => {
      const contextId = await adapter.newContext();
      await adapter.navigate(contextId, "about:blank");
      const result = await adapter.evaluate(contextId, "1 + 2");
      expect(result).toBe(3);
      await adapter.closeContext(contextId);
    });

    it("full lifecycle: launch → context → navigate → close", async () => {
      const contextId = await adapter.newContext();
      await adapter.navigate(contextId, "about:blank");
      const title = await adapter.evaluate(contextId, "document.title");
      expect(typeof title === "string" || title === undefined || title === null).toBe(true);
      await adapter.closeContext(contextId);
      // adapter.close() is called in afterAll
    });
  },
  { timeout: 30_000 },
);

// ---------------------------------------------------------------------------
// Unit-level tests that do NOT need a live browser
// ---------------------------------------------------------------------------

describe("createAdapter factory (unit)", () => {
  it("returns an object with all ProtocolAdapter methods for cdp", () => {
    // We cannot call launch() without a binary, but we can verify shape.
    const adapter = createAdapter({ protocol: "cdp", cdp: { executablePath: "/fake/chrome", port: 19223 } });
    expect(typeof adapter.launch).toBe("function");
    expect(typeof adapter.newContext).toBe("function");
    expect(typeof adapter.closeContext).toBe("function");
    expect(typeof adapter.navigate).toBe("function");
    expect(typeof adapter.evaluate).toBe("function");
    expect(typeof adapter.dispatchEvent).toBe("function");
    expect(typeof adapter.close).toBe("function");
  });

  it("throws for unsupported protocol", () => {
    expect(() =>
      // @ts-expect-error — testing invalid protocol at runtime
      createAdapter({ protocol: "bidi" }),
    ).toThrow("Unsupported protocol");
  });
});
