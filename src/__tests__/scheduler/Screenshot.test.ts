/**
 * Unit tests for screenshot capture logic (AC-7).
 *
 * AC-1: screenshot is taken on failed and timedOut tests
 * AC-2: saved path follows .kaze/screenshots/<sanitized-name>-<testId>-<timestamp>.png
 * AC-4: screenshot disabled when screenshotEnabled = false
 * AC-5: screenshot failure does not affect test result
 * AC-6: screenshot is PNG (adapter called with format: "png" via Page.captureScreenshot)
 * AC-9: filename includes testId for uniqueness in parallel execution
 * AC-10: filename length is capped (200 chars for sanitized name, fallback to "unnamed")
 */

import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

import type { BrowserPool } from "../../pool/BrowserPool.js";
import type { PooledContext } from "../../pool/types.js";
import { Scheduler } from "../../scheduler/Scheduler.js";
import type { TestCase } from "../../scheduler/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(id: string): PooledContext {
  return { contextId: id, adapterId: `adapter-${id}` };
}

interface MockAdapter {
  screenshot: ReturnType<typeof vi.fn>;
}

function makeMockPoolWithScreenshot(
  screenshotImpl: () => Promise<Buffer>,
): { pool: BrowserPool; adapter: MockAdapter } {
  const ctx = makeCtx("ctx-0");
  const adapter: MockAdapter = {
    screenshot: vi.fn(screenshotImpl),
  };

  const pool = {
    acquire: vi.fn(async (): Promise<PooledContext> => ctx),
    release: vi.fn(),
    init: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    stats: vi.fn().mockReturnValue({ totalContexts: 1, busy: 0, idle: 1, processes: 1, crashes: 0 }),
    getAdapter: vi.fn().mockReturnValue(adapter),
  } as unknown as BrowserPool;

  return { pool, adapter };
}

function makeMockPoolNoScreenshot(): BrowserPool {
  const ctx = makeCtx("ctx-0");
  const adapter = {
    // No screenshot method — tests AC-5 adapter without screenshot support
  };

  return {
    acquire: vi.fn(async (): Promise<PooledContext> => ctx),
    release: vi.fn(),
    init: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    stats: vi.fn().mockReturnValue({ totalContexts: 1, busy: 0, idle: 1, processes: 1, crashes: 0 }),
    getAdapter: vi.fn().mockReturnValue(adapter),
  } as unknown as BrowserPool;
}

const SCREENSHOTS_DIR = path.join(process.cwd(), ".kaze", "screenshots");
const LAST_RUN_PATH = path.join(process.cwd(), ".kaze", "last-run.json");

async function cleanScreenshotsDir(): Promise<void> {
  try {
    await fs.rm(SCREENSHOTS_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function cleanLastRun(): void {
  try { fsSync.unlinkSync(LAST_RUN_PATH); } catch { /* ファイルがなければ無視 */ }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Screenshot capture", () => {
  beforeEach(async () => {
    cleanLastRun();
    await cleanScreenshotsDir();
  });
  afterEach(async () => {
    await cleanScreenshotsDir();
    cleanLastRun();
  });

  // -------------------------------------------------------------------------
  // AC-1: screenshot taken on failed test
  // -------------------------------------------------------------------------
  describe("AC-1: screenshot on failure", () => {
    it("captures screenshot when test fails", async () => {
      const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header bytes
      const { pool, adapter } = makeMockPoolWithScreenshot(() => Promise.resolve(pngData));
      const scheduler = new Scheduler(pool, { screenshot: true });

      scheduler.enqueue([
        {
          id: "fail-1",
          name: "Failing test",
          fn: async () => { throw new Error("test error"); },
        },
      ]);

      const [result] = await scheduler.run();

      expect(result.status).toBe("failed");
      expect(adapter.screenshot).toHaveBeenCalledOnce();
      expect(result.screenshotPath).toBeDefined();
    });

    it("captures screenshot when test times out", async () => {
      const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const { pool, adapter } = makeMockPoolWithScreenshot(() => Promise.resolve(pngData));
      const scheduler = new Scheduler(pool, { screenshot: true });

      scheduler.enqueue([
        {
          id: "timeout-1",
          name: "Timeout test",
          timeout: 30,
          fn: async () => { await new Promise((r) => setTimeout(r, 500)); },
        },
      ]);

      const [result] = await scheduler.run();

      expect(result.status).toBe("timedOut");
      expect(adapter.screenshot).toHaveBeenCalledOnce();
      expect(result.screenshotPath).toBeDefined();
    });

    it("does NOT capture screenshot when test passes", async () => {
      const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const { pool, adapter } = makeMockPoolWithScreenshot(() => Promise.resolve(pngData));
      const scheduler = new Scheduler(pool, { screenshot: true });

      scheduler.enqueue([
        {
          id: "pass-1",
          name: "Passing test",
          fn: async () => {},
        },
      ]);

      const [result] = await scheduler.run();

      expect(result.status).toBe("passed");
      expect(adapter.screenshot).not.toHaveBeenCalled();
      expect(result.screenshotPath).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // AC-2 / AC-9: saved path follows naming convention including testId
  // -------------------------------------------------------------------------
  describe("AC-2 / AC-9: screenshot path naming", () => {
    it("saves screenshot to .kaze/screenshots/<sanitized-name>-<testId>-<timestamp>.png", async () => {
      const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const { pool } = makeMockPoolWithScreenshot(() => Promise.resolve(pngData));
      const scheduler = new Scheduler(pool, { screenshot: true });

      scheduler.enqueue([
        {
          id: "naming-1",
          name: "My test case",
          fn: async () => { throw new Error("fail"); },
        },
      ]);

      const [result] = await scheduler.run();

      expect(result.screenshotPath).toBeDefined();
      const p = result.screenshotPath!;

      // Must end with .png
      expect(p).toMatch(/\.png$/);

      // Must be inside .kaze/screenshots/
      expect(p).toContain(path.join(".kaze", "screenshots"));

      // Filename must use sanitized test name + testId (spaces → dashes)
      const filename = path.basename(p);
      expect(filename).toMatch(/^My-test-case-naming-1-\d+\.png$/);
    });

    it("replaces special characters in test name with dashes", async () => {
      const pngData = Buffer.from([0]);
      const { pool } = makeMockPoolWithScreenshot(() => Promise.resolve(pngData));
      const scheduler = new Scheduler(pool, { screenshot: true });

      scheduler.enqueue([
        {
          id: "special-1",
          name: "test: foo/bar <baz>",
          fn: async () => { throw new Error("fail"); },
        },
      ]);

      const [result] = await scheduler.run();

      expect(result.screenshotPath).toBeDefined();
      const filename = path.basename(result.screenshotPath!);
      // Special chars replaced with -
      expect(filename).not.toMatch(/[/:<>]/);
      expect(filename).toMatch(/^test--foo-bar--baz--special-1-\d+\.png$/);
    });

    it("AC-9: two tests with same name but different ids produce different filenames", async () => {
      const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const { pool } = makeMockPoolWithScreenshot(() => Promise.resolve(pngData));
      const scheduler = new Scheduler(pool, { screenshot: true });

      scheduler.enqueue([
        {
          id: "dup-1",
          name: "Duplicate name",
          fn: async () => { throw new Error("fail"); },
        },
        {
          id: "dup-2",
          name: "Duplicate name",
          fn: async () => { throw new Error("fail"); },
        },
      ]);

      const results = await scheduler.run();
      const paths = results
        .map((r) => r.screenshotPath)
        .filter((p): p is string => p !== undefined);

      expect(paths).toHaveLength(2);
      // The two paths must be different (testId makes them unique)
      expect(paths[0]).not.toBe(paths[1]);
    });

    it("actually writes the PNG file to disk", async () => {
      const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const { pool } = makeMockPoolWithScreenshot(() => Promise.resolve(pngData));
      const scheduler = new Scheduler(pool, { screenshot: true });

      scheduler.enqueue([
        {
          id: "disk-1",
          name: "disk write test",
          fn: async () => { throw new Error("fail"); },
        },
      ]);

      const [result] = await scheduler.run();

      expect(result.screenshotPath).toBeDefined();
      const diskContent = await fs.readFile(result.screenshotPath!);
      expect(diskContent).toEqual(pngData);
    });
  });

  // -------------------------------------------------------------------------
  // AC-10: filename edge cases — empty name and long name
  // -------------------------------------------------------------------------
  describe("AC-10: filename edge cases", () => {
    it("uses 'unnamed' fallback when test name is empty string", async () => {
      const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const { pool } = makeMockPoolWithScreenshot(() => Promise.resolve(pngData));
      const scheduler = new Scheduler(pool, { screenshot: true });

      scheduler.enqueue([
        {
          id: "empty-name-1",
          name: "",
          fn: async () => { throw new Error("fail"); },
        },
      ]);

      const [result] = await scheduler.run();

      expect(result.screenshotPath).toBeDefined();
      const filename = path.basename(result.screenshotPath!);
      expect(filename).toMatch(/^unnamed-empty-name-1-\d+\.png$/);
    });

    it("uses 'unnamed' fallback when test name is all non-ASCII (converts to all dashes)", async () => {
      const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const { pool } = makeMockPoolWithScreenshot(() => Promise.resolve(pngData));
      const scheduler = new Scheduler(pool, { screenshot: true });

      scheduler.enqueue([
        {
          id: "nonasc-1",
          name: "日本語テスト名",
          fn: async () => { throw new Error("fail"); },
        },
      ]);

      const [result] = await scheduler.run();

      expect(result.screenshotPath).toBeDefined();
      const filename = path.basename(result.screenshotPath!);
      expect(filename).toMatch(/^unnamed-nonasc-1-\d+\.png$/);
    });

    it("truncates sanitized name to 200 chars to avoid ENAMETOOLONG", async () => {
      const longName = "a".repeat(300);
      const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const { pool } = makeMockPoolWithScreenshot(() => Promise.resolve(pngData));
      const scheduler = new Scheduler(pool, { screenshot: true });

      scheduler.enqueue([
        {
          id: "long-1",
          name: longName,
          fn: async () => { throw new Error("fail"); },
        },
      ]);

      const [result] = await scheduler.run();

      expect(result.screenshotPath).toBeDefined();
      const filename = path.basename(result.screenshotPath!);
      // sanitized name part must be at most 200 chars
      const namePartMatch = filename.match(/^([a-zA-Z0-9_\-.]+)-long-1-\d+\.png$/);
      expect(namePartMatch).not.toBeNull();
      expect(namePartMatch![1].length).toBeLessThanOrEqual(200);
      // overall filename must be well under 255 bytes
      expect(Buffer.byteLength(filename)).toBeLessThan(255);
    });
  });

  // -------------------------------------------------------------------------
  // AC-4: --screenshot=off disables capture
  // -------------------------------------------------------------------------
  describe("AC-4: screenshot disabled", () => {
    it("does not capture screenshot when screenshot=false", async () => {
      const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const { pool, adapter } = makeMockPoolWithScreenshot(() => Promise.resolve(pngData));
      const scheduler = new Scheduler(pool, { screenshot: false });

      scheduler.enqueue([
        {
          id: "off-1",
          name: "No screenshot test",
          fn: async () => { throw new Error("fail"); },
        },
      ]);

      const [result] = await scheduler.run();

      expect(result.status).toBe("failed");
      expect(adapter.screenshot).not.toHaveBeenCalled();
      expect(result.screenshotPath).toBeUndefined();
    });

    it("screenshot defaults to enabled when no option provided", async () => {
      const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const { pool, adapter } = makeMockPoolWithScreenshot(() => Promise.resolve(pngData));
      // No options passed — screenshot should default to enabled
      const scheduler = new Scheduler(pool);

      scheduler.enqueue([
        {
          id: "default-1",
          name: "Default screenshot test",
          fn: async () => { throw new Error("fail"); },
        },
      ]);

      const [result] = await scheduler.run();

      expect(result.status).toBe("failed");
      expect(adapter.screenshot).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // AC-5: screenshot failure does not affect test result
  // -------------------------------------------------------------------------
  describe("AC-5: best-effort — screenshot failure does not affect test result", () => {
    it("test still records failed status even if screenshot throws", async () => {
      const { pool } = makeMockPoolWithScreenshot(async () => {
        throw new Error("screenshot failed: connection lost");
      });
      const scheduler = new Scheduler(pool, { screenshot: true });

      scheduler.enqueue([
        {
          id: "ss-fail-1",
          name: "Screenshot error test",
          fn: async () => { throw new Error("test error"); },
        },
      ]);

      const [result] = await scheduler.run();

      // Test result must reflect the original test failure, not the screenshot error
      expect(result.status).toBe("failed");
      expect(result.error).toContain("test error");
      expect(result.screenshotPath).toBeUndefined();
    });

    it("adapter without screenshot method is handled gracefully", async () => {
      const pool = makeMockPoolNoScreenshot();
      const scheduler = new Scheduler(pool, { screenshot: true });

      scheduler.enqueue([
        {
          id: "no-ss-1",
          name: "No screenshot adapter test",
          fn: async () => { throw new Error("fail"); },
        },
      ]);

      const [result] = await scheduler.run();

      expect(result.status).toBe("failed");
      expect(result.screenshotPath).toBeUndefined();
    });
  });
});
