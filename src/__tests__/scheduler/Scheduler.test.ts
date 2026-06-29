/**
 * Unit tests for Scheduler.
 *
 * AC-5: (a) concurrency limited by pool size
 *        (b) failed tests run first (priority reordering)
 *        (c) one failure does not stop other tests
 * AC-6: Context isolation — a test's context is not leaked to the next test
 */

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

/**
 * Build a mock BrowserPool with a fixed pool size.
 */
function makeMockPool(poolSize: number): { pool: BrowserPool; concurrencyLog: number[] } {
  let currentConcurrency = 0;
  const concurrencyLog: number[] = [];
  let ctxCounter = 0;
  let busy = 0;
  const queue: Array<() => void> = [];

  const pool = {
    acquire: vi.fn(async (): Promise<PooledContext> => {
      if (busy >= poolSize) {
        await new Promise<void>((resolve) => queue.push(resolve));
      }
      busy++;
      currentConcurrency++;
      concurrencyLog.push(currentConcurrency);
      return makeCtx(`ctx-${ctxCounter++}`);
    }),
    release: vi.fn((_ctx: PooledContext) => {
      currentConcurrency--;
      busy--;
      const next = queue.shift();
      if (next) next();
    }),
    init: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    stats: vi.fn().mockReturnValue({ totalContexts: poolSize, busy: 0, idle: poolSize, processes: 1, crashes: 0 }),
  } as unknown as BrowserPool;

  return { pool, concurrencyLog };
}

// ---------------------------------------------------------------------------
// last-run.json helpers
// ---------------------------------------------------------------------------

const LAST_RUN_DIR = path.join(process.cwd(), ".kaze");
const LAST_RUN_PATH = path.join(LAST_RUN_DIR, "last-run.json");

async function writeLastRun(failedIds: string[]): Promise<void> {
  await fs.mkdir(LAST_RUN_DIR, { recursive: true });
  await fs.writeFile(LAST_RUN_PATH, JSON.stringify({ failedIds }), "utf-8");
}

async function readLastRun(): Promise<{ failedIds: string[] } | null> {
  try {
    const raw = await fs.readFile(LAST_RUN_PATH, "utf-8");
    return JSON.parse(raw) as { failedIds: string[] };
  } catch {
    return null;
  }
}

async function removeLastRun(): Promise<void> {
  try {
    await fs.unlink(LAST_RUN_PATH);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Scheduler", () => {
  beforeEach(async () => {
    await removeLastRun();
  });
  afterEach(async () => {
    await removeLastRun();
  });

  // -------------------------------------------------------------------------
  // AC-5(a): Concurrency limited by pool size
  // -------------------------------------------------------------------------
  describe("AC-5(a): concurrency capped at pool size", () => {
    it("never exceeds pool capacity when running more tests than slots", async () => {
      const POOL_SIZE = 2;
      const { pool, concurrencyLog } = makeMockPool(POOL_SIZE);
      const scheduler = new Scheduler(pool);

      const tests: TestCase[] = Array.from({ length: 5 }, (_, i) => ({
        id: `t${i}`,
        name: `Test ${i}`,
        fn: async (_ctx) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
        },
      }));

      scheduler.enqueue(tests);
      await scheduler.run();

      expect(concurrencyLog.length).toBe(5);
      expect(Math.max(...concurrencyLog)).toBeLessThanOrEqual(POOL_SIZE);
    });

    it("runs all tests to completion", async () => {
      const { pool } = makeMockPool(3);
      const scheduler = new Scheduler(pool);

      const tests: TestCase[] = Array.from({ length: 4 }, (_, i) => ({
        id: `t${i}`,
        name: `Test ${i}`,
        fn: async () => {},
      }));

      scheduler.enqueue(tests);
      const results = await scheduler.run();

      expect(results).toHaveLength(4);
      expect(results.every((r) => r.status === "passed")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // AC-5(b): Failed tests run first
  // -------------------------------------------------------------------------
  describe("AC-5(b): failed tests are prioritized", () => {
    it("puts previously failed tests at the front of the queue", async () => {
      await writeLastRun(["t2", "t4"]);

      const { pool } = makeMockPool(1); // single slot forces strict ordering
      const scheduler = new Scheduler(pool);

      const executionOrder: string[] = [];
      const tests: TestCase[] = ["t0", "t1", "t2", "t3", "t4"].map((id) => ({
        id,
        name: id,
        fn: async () => {
          executionOrder.push(id);
        },
      }));

      scheduler.enqueue(tests);
      await scheduler.run();

      const firstTwo = executionOrder.slice(0, 2);
      expect(firstTwo).toContain("t2");
      expect(firstTwo).toContain("t4");
    });

    it("works fine when last-run.json does not exist", async () => {
      await removeLastRun();

      const { pool } = makeMockPool(2);
      const scheduler = new Scheduler(pool);

      const tests: TestCase[] = ["a", "b", "c"].map((id) => ({
        id,
        name: id,
        fn: async () => {},
      }));

      scheduler.enqueue(tests);
      const results = await scheduler.run();

      expect(results).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // AC-5(c) & AC-4: One failure does not stop other tests
  // -------------------------------------------------------------------------
  describe("AC-5(c): one failure does not halt execution", () => {
    it("continues running tests after one throws", async () => {
      const { pool } = makeMockPool(2);
      const scheduler = new Scheduler(pool);

      let otherTestRan = false;

      const tests: TestCase[] = [
        {
          id: "failing",
          name: "Failing test",
          fn: async () => {
            throw new Error("intentional failure");
          },
        },
        {
          id: "passing",
          name: "Passing test",
          fn: async () => {
            otherTestRan = true;
          },
        },
      ];

      scheduler.enqueue(tests);
      const results = await scheduler.run();

      expect(otherTestRan).toBe(true);
      expect(results.find((r) => r.id === "failing")?.status).toBe("failed");
      expect(results.find((r) => r.id === "passing")?.status).toBe("passed");
    });

    it("records error message for failed tests", async () => {
      const { pool } = makeMockPool(1);
      const scheduler = new Scheduler(pool);

      scheduler.enqueue([
        {
          id: "err-test",
          name: "Error test",
          fn: async () => {
            throw new Error("boom");
          },
        },
      ]);
      const [result] = await scheduler.run();

      expect(result.status).toBe("failed");
      expect(result.error).toContain("boom");
    });

    it("records timedOut status when test exceeds timeout", async () => {
      const { pool } = makeMockPool(1);
      const scheduler = new Scheduler(pool);

      scheduler.enqueue([
        {
          id: "slow",
          name: "Slow test",
          timeout: 50,
          fn: async () => {
            await new Promise((resolve) => setTimeout(resolve, 500));
          },
        },
      ]);
      const [result] = await scheduler.run();

      expect(result.status).toBe("timedOut");
    });
  });

  // -------------------------------------------------------------------------
  // AC-3: last-run.json write-back
  // -------------------------------------------------------------------------
  describe("AC-3: last-run.json persistence", () => {
    it("writes results to .kaze/last-run.json after run", async () => {
      const { pool } = makeMockPool(2);
      const scheduler = new Scheduler(pool);

      scheduler.enqueue([
        { id: "p1", name: "Pass 1", fn: async () => {} },
        {
          id: "f1",
          name: "Fail 1",
          fn: async () => {
            throw new Error("x");
          },
        },
      ]);
      await scheduler.run();

      const lastRun = await readLastRun();
      expect(lastRun).not.toBeNull();
      expect(lastRun!.failedIds).toContain("f1");
      expect(lastRun!.failedIds).not.toContain("p1");
    });

    it("writes empty failedIds when all tests pass", async () => {
      const { pool } = makeMockPool(2);
      const scheduler = new Scheduler(pool);

      scheduler.enqueue([
        { id: "a", name: "A", fn: async () => {} },
        { id: "b", name: "B", fn: async () => {} },
      ]);
      await scheduler.run();

      const lastRun = await readLastRun();
      expect(lastRun!.failedIds).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // AC-6: Context isolation
  // -------------------------------------------------------------------------
  describe("AC-6: context isolation", () => {
    it("acquire and release are called once per test", async () => {
      const { pool } = makeMockPool(2);
      const scheduler = new Scheduler(pool);

      const tests: TestCase[] = Array.from({ length: 4 }, (_, i) => ({
        id: `iso-${i}`,
        name: `Isolation ${i}`,
        fn: async () => {},
      }));

      scheduler.enqueue(tests);
      await scheduler.run();

      expect(pool.release).toHaveBeenCalledTimes(4);
      expect(pool.acquire).toHaveBeenCalledTimes(4);
    });

    it("release is called even when the test throws", async () => {
      const { pool } = makeMockPool(1);
      const scheduler = new Scheduler(pool);

      scheduler.enqueue([
        {
          id: "throws",
          name: "Throws",
          fn: async () => {
            throw new Error("oops");
          },
        },
      ]);
      await scheduler.run();

      expect(pool.release).toHaveBeenCalledTimes(1);
    });

    it("release is called even when the test times out", async () => {
      const { pool } = makeMockPool(1);
      const scheduler = new Scheduler(pool);

      scheduler.enqueue([
        {
          id: "timeout-release",
          name: "Timeout release",
          timeout: 30,
          fn: async () => {
            await new Promise((resolve) => setTimeout(resolve, 300));
          },
        },
      ]);
      await scheduler.run();

      expect(pool.release).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // General: durationMs is recorded
  // -------------------------------------------------------------------------
  describe("result metadata", () => {
    it("records durationMs for each test", async () => {
      const { pool } = makeMockPool(1);
      const scheduler = new Scheduler(pool);

      scheduler.enqueue([{ id: "t", name: "T", fn: async () => {} }]);
      const [result] = await scheduler.run();

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.durationMs).toBe("number");
    });
  });

  // -------------------------------------------------------------------------
  // B-1: queue is cleared after run() — no duplicate execution on second run
  // -------------------------------------------------------------------------
  describe("B-1: queue cleared after run()", () => {
    it("does not re-run tests from a previous run when enqueue→run→enqueue→run", async () => {
      const { pool } = makeMockPool(2);
      const scheduler = new Scheduler(pool);

      const firstRunIds: string[] = [];
      const secondRunIds: string[] = [];

      const tests1: TestCase[] = [
        { id: "r1-a", name: "Run1 A", fn: async () => { firstRunIds.push("r1-a"); } },
        { id: "r1-b", name: "Run1 B", fn: async () => { firstRunIds.push("r1-b"); } },
      ];
      const tests2: TestCase[] = [
        { id: "r2-a", name: "Run2 A", fn: async () => { secondRunIds.push("r2-a"); } },
      ];

      scheduler.enqueue(tests1);
      await scheduler.run();

      scheduler.enqueue(tests2);
      await scheduler.run();

      // First run tests must not appear in second run
      expect(firstRunIds).toHaveLength(2);
      expect(secondRunIds).toHaveLength(1);
      expect(secondRunIds).not.toContain("r1-a");
      expect(secondRunIds).not.toContain("r1-b");
    });

    it("second run only contains tests enqueued after first run", async () => {
      const { pool } = makeMockPool(2);
      const scheduler = new Scheduler(pool);

      const executed: string[] = [];

      scheduler.enqueue([
        { id: "first", name: "First", fn: async () => { executed.push("first"); } },
      ]);
      const firstResults = await scheduler.run();

      scheduler.enqueue([
        { id: "second", name: "Second", fn: async () => { executed.push("second"); } },
      ]);
      const secondResults = await scheduler.run();

      expect(firstResults).toHaveLength(1);
      expect(firstResults[0].id).toBe("first");
      expect(secondResults).toHaveLength(1);
      expect(secondResults[0].id).toBe("second");
    });
  });

  // -------------------------------------------------------------------------
  // GAP-1: run() concurrent call guard
  // -------------------------------------------------------------------------
  describe("GAP-1: run() rejects while already running", () => {
    it("rejects the second run() call if the first has not finished", async () => {
      const { pool } = makeMockPool(1);
      const scheduler = new Scheduler(pool);

      // Enqueue a test that takes a bit
      scheduler.enqueue([
        {
          id: "slow",
          name: "Slow",
          fn: async () => { await new Promise((r) => setTimeout(r, 50)); },
        },
      ]);

      const firstRun = scheduler.run();

      // Attempt a second concurrent run immediately
      await expect(scheduler.run()).rejects.toThrow(/already in progress/i);

      // First run should still complete normally
      const results = await firstRun;
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("passed");
    });
  });

  // -------------------------------------------------------------------------
  // GAP-2: pool.close() during run() does not hang
  // -------------------------------------------------------------------------
  describe("GAP-2: acquire() rejection is handled gracefully", () => {
    it("records failed result and continues when acquire() rejects", async () => {
      // Pool whose acquire() rejects immediately
      const failPool = {
        acquire: vi.fn(async () => { throw new Error("BrowserPool is closed"); }),
        release: vi.fn(),
        init: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        stats: vi.fn().mockReturnValue({ totalContexts: 0, busy: 0, idle: 0, processes: 0, crashes: 0 }),
      } as unknown as BrowserPool;

      const scheduler = new Scheduler(failPool);
      scheduler.enqueue([
        { id: "t1", name: "T1", fn: async () => {} },
        { id: "t2", name: "T2", fn: async () => {} },
      ]);

      // run() should resolve (not throw) even though acquire() always rejects
      const results = await scheduler.run();

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.status === "failed")).toBe(true);
      expect(results[0].error).toMatch(/BrowserPool is closed/);
    });
  });

  // -------------------------------------------------------------------------
  // AC-11: ctx._cancel() is invoked when a test times out
  // -------------------------------------------------------------------------
  describe("AC-11: page cancellation on Scheduler timeout", () => {
    it("calls ctx._cancel() when the test times out", async () => {
      const { pool } = makeMockPool(1);
      const scheduler = new Scheduler(pool);

      let cancelCalled = false;

      scheduler.enqueue([
        {
          id: "cancel-test",
          name: "Cancel test",
          timeout: 30,
          fn: async (ctx) => {
            // Register a mock _cancel on the ctx to detect Scheduler calling it
            ctx._cancel = () => { cancelCalled = true; };
            await new Promise((resolve) => setTimeout(resolve, 500));
          },
        },
      ]);

      const [result] = await scheduler.run();

      expect(result.status).toBe("timedOut");
      expect(cancelCalled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // GAP-3: _writeLastRun failure does not throw from run()
  // -------------------------------------------------------------------------
  describe("GAP-3: last-run.json write failure does not throw", () => {
    it("returns results normally even when the filesystem write fails", async () => {
      const { pool } = makeMockPool(1);
      const scheduler = new Scheduler(pool);

      // Place a regular file at the .kaze path so that mkdir(..., {recursive: true})
      // succeeds but writeFile fails because the target directory path conflicts.
      // Easier: put a regular FILE at the .kaze directory path so mkdir throws.
      // But recursive mkdir ignores EEXIST. Instead we write a file *at* the
      // last-run.json path's parent but as a non-directory entry.
      //
      // The most reliable approach: temporarily create .kaze as a file so that
      // fs.mkdir(".kaze", { recursive: true }) throws ENOTDIR.
      const kazeDir = LAST_RUN_DIR;

      // Remove any existing .kaze dir/file first
      try {
        await fs.rm(kazeDir, { recursive: true, force: true });
      } catch { /* ignore */ }

      // Create .kaze as a regular file — mkdir will fail with ENOTDIR
      await fs.writeFile(kazeDir, "blocker");

      scheduler.enqueue([
        { id: "ok", name: "OK", fn: async () => {} },
      ]);

      // run() must not throw despite write failure
      const results = await scheduler.run();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("passed");

      // Restore: remove the blocker file
      try {
        await fs.rm(kazeDir, { force: true });
      } catch { /* ignore */ }
    });
  });
});
