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
    // AC-3: reorder queue so previously-failed tests go first
    const orderedTests = await this._prioritize([...this.queue]);

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
  }

  // -------------------------------------------------------------------------
  // Private: run a single test
  // -------------------------------------------------------------------------

  private async _runOne(test: TestCase): Promise<TestResult> {
    const timeout = test.timeout ?? DEFAULT_TIMEOUT_MS;
    const start = Date.now();

    // AC-2: acquire a context — blocks if pool is saturated
    const ctx = await this.pool.acquire();

    try {
      // Race the test function against a timeout
      await Promise.race([
        test.fn(ctx),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new TimeoutError(`Test "${test.name}" timed out after ${timeout}ms`)),
            timeout,
          ),
        ),
      ]);

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
    const failedIds = results
      .filter((r) => r.status === "failed" || r.status === "timedOut")
      .map((r) => r.id);

    const data: LastRunData = { failedIds };

    await fs.mkdir(LAST_RUN_DIR, { recursive: true });
    await fs.writeFile(LAST_RUN_PATH, JSON.stringify(data, null, 2), "utf-8");
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
