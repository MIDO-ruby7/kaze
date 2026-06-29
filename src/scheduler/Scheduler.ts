/**
 * Scheduler — enqueues TestCases and runs them against a BrowserPool.
 *
 * AC-1: enqueue(tests) + run(): Promise<TestResult[]>
 * AC-2: acquire/release per test, concurrency bounded by pool size
 * AC-3: reads .kaze/last-run.json to prioritize previously-failed tests;
 *       writes results back after each run
 * AC-4: individual test failures / timeouts do not abort the whole run
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { BrowserPool } from "../pool/BrowserPool.js";

import type { TestCase, TestResult } from "./types.js";


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const LAST_RUN_DIR = path.join(process.cwd(), ".kaze");
const LAST_RUN_PATH = path.join(LAST_RUN_DIR, "last-run.json");

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface LastRunData {
  failedIds: string[];
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export class Scheduler {
  private queue: TestCase[] = [];
  /** True while run() is executing — prevents concurrent run() calls. */
  private _running = false;

  constructor(private readonly pool: BrowserPool) {}

  // -------------------------------------------------------------------------
  // AC-1: enqueue
  // -------------------------------------------------------------------------

  enqueue(tests: TestCase[]): void {
    this.queue.push(...tests);
  }

  // -------------------------------------------------------------------------
  // AC-1 & AC-2 & AC-3: run
  // -------------------------------------------------------------------------

  async run(): Promise<TestResult[]> {
    // GAP-1: Guard against concurrent run() calls
    if (this._running) {
      return Promise.reject(new Error("Scheduler.run() is already in progress"));
    }
    this._running = true;

    // B-1: Snapshot the queue then clear it so a subsequent enqueue→run does
    // not repeat the same tests.
    const snapshot = [...this.queue];
    this.queue = [];

    try {
      // AC-3: reorder queue so previously-failed tests go first
      const orderedTests = await this._prioritize(snapshot);

      const results: TestResult[] = [];

      // Run tests in parallel, bounded by pool.acquire() (which blocks when all
      // slots are busy, naturally capping concurrency at pool size).
      await Promise.all(
        orderedTests.map(async (test) => {
          const result = await this._runOne(test);
          results.push(result);
        }),
      );

      // AC-3: persist results for next run
      await this._writeLastRun(results);

      return results;
    } finally {
      this._running = false;
    }
  }

  // -------------------------------------------------------------------------
  // Private: run a single test
  // -------------------------------------------------------------------------

  private async _runOne(test: TestCase): Promise<TestResult> {
    const timeout = test.timeout ?? DEFAULT_TIMEOUT_MS;
    const start = Date.now();

    // AC-2: acquire a context — blocks if pool is saturated
    // GAP-2: If acquire() rejects (e.g. pool.close() called mid-run), record
    // the test as failed and let the overall run() continue.
    let ctx;
    try {
      ctx = await this.pool.acquire();
    } catch (err: unknown) {
      return {
        id: test.id,
        name: test.name,
        status: "failed",
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      // B-2: Clear the timeout timer after Promise.race resolves or rejects to
      // prevent timer leaks.
      let timerId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timerId = setTimeout(
          () => reject(new TimeoutError(`Test "${test.name}" timed out after ${timeout}ms`)),
          timeout,
        );
      });

      try {
        // Race the test function against a timeout
        await Promise.race([test.fn(ctx), timeoutPromise]);
      } finally {
        clearTimeout(timerId);
      }

      return {
        id: test.id,
        name: test.name,
        status: "passed",
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const isTimeout = err instanceof TimeoutError;
      return {
        id: test.id,
        name: test.name,
        status: isTimeout ? "timedOut" : "failed",
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      // AC-2 & AC-6: always release so the context goes back to the pool
      this.pool.release(ctx);
    }
  }

  // -------------------------------------------------------------------------
  // Private: AC-3 priority reordering
  // -------------------------------------------------------------------------

  private async _prioritize(tests: TestCase[]): Promise<TestCase[]> {
    const failedIds = await this._readLastRunFailedIds();
    if (failedIds.size === 0) return tests;

    const priority: TestCase[] = [];
    const rest: TestCase[] = [];

    for (const t of tests) {
      if (failedIds.has(t.id)) {
        priority.push(t);
      } else {
        rest.push(t);
      }
    }

    return [...priority, ...rest];
  }

  private async _readLastRunFailedIds(): Promise<Set<string>> {
    try {
      const raw = await fs.readFile(LAST_RUN_PATH, "utf-8");
      const data = JSON.parse(raw) as LastRunData;
      return new Set(data.failedIds ?? []);
    } catch {
      return new Set();
    }
  }

  private async _writeLastRun(results: TestResult[]): Promise<void> {
    // GAP-3: If the write fails (e.g. read-only filesystem), warn and continue
    // rather than throwing — the run results are still returned to the caller.
    try {
      const failedIds = results
        .filter((r) => r.status === "failed" || r.status === "timedOut")
        .map((r) => r.id);

      const data: LastRunData = { failedIds };

      await fs.mkdir(LAST_RUN_DIR, { recursive: true });
      await fs.writeFile(LAST_RUN_PATH, JSON.stringify(data, null, 2), "utf-8");
    } catch (err: unknown) {
      console.warn(
        "[Scheduler] Failed to write last-run.json:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Internal sentinel error
// ---------------------------------------------------------------------------

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}
