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

import { describe, it, expect, vi, afterEach } from "vitest";

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
});
