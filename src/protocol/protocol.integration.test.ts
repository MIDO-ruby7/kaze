/**
 * Integration tests for the ProtocolAdapter / CdpAdapter (AC-4).
 *
 * These tests require a headless Chromium binary in ~/.kaze/browsers/.
 * If no browser is found, the suite is skipped so CI can still pass
 * before the browser-downloader step has run.
 *
 * GAP-4: This file imports only from ./index.js (the public factory API).
 * No direct imports from CdpAdapter.ts or ProtocolAdapter.ts.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdapter } from "./index.js";
import type { ProtocolAdapter } from "./index.js";

// ---------------------------------------------------------------------------
// Pre-flight: locate Chromium
// ---------------------------------------------------------------------------

/** Platform-specific binary names to search for inside the install directory. */
const CHROMIUM_BIN_NAMES =
  process.platform === "darwin"
    ? ["Google Chrome for Testing", "chrome", "Chromium"]
    : process.platform === "win32"
      ? ["chrome.exe"]
      : ["chrome", "chromium", "chrome-linux"];

function findFileRecursive(dir: string, name: string): string | undefined {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return undefined;
}

function resolveChromiumExecutable(installDir: string): string {
  for (const bin of CHROMIUM_BIN_NAMES) {
    const found = findFileRecursive(installDir, bin);
    if (found) return found;
  }
  throw new Error(
    `Could not find Chromium executable in ${installDir}. Looked for: ${CHROMIUM_BIN_NAMES.join(", ")}`,
  );
}

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

describe.skipIf(!!process.env.KAZE_SKIP_E2E || !chromiumDir)(
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
