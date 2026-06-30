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

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface LastRunData {
  failedIds: string[];
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export interface SchedulerOptions {
  /** Whether to capture screenshots on failure/timeout. Defaults to true. */
  screenshot?: boolean;
  /** Override the path to last-run.json (useful for test isolation). */
  lastRunPath?: string;
  /** Override the directory where screenshots are saved (useful for test isolation). */
  screenshotDir?: string;
  /** Default number of retries for all tests. Per-test retries take precedence. */
  retries?: number;
}

export class Scheduler {
  private queue: TestCase[] = [];
  /** True while run() is executing — prevents concurrent run() calls. */
  private _running = false;
  private readonly screenshotEnabled: boolean;
  private readonly options: SchedulerOptions;

  constructor(
    private readonly pool: BrowserPool,
    options: SchedulerOptions = {},
  ) {
    this.options = options;
    this.screenshotEnabled = options.screenshot !== false;
  }

  private get _lastRunPath(): string {
    return this.options.lastRunPath ?? path.join(process.cwd(), ".kaze", "last-run.json");
  }

  private get _lastRunDir(): string {
    return path.dirname(this._lastRunPath);
  }

  private get _screenshotsDir(): string {
    return this.options.screenshotDir ?? path.join(process.cwd(), ".kaze", "screenshots");
  }

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
          const result = await this._runOne(test, this.options.retries);
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
  // Private: run a single test (with retry support)
  // -------------------------------------------------------------------------

  private async _runOne(test: TestCase, retries?: number): Promise<TestResult> {
    const timeout = test.timeout ?? DEFAULT_TIMEOUT_MS;
    const start = Date.now();

    // Determine effective retry count: per-test retries > argument > 0
    const effectiveRetries = test.retries ?? retries ?? 0;
    const maxAttempts = effectiveRetries + 1;
    const attempts: string[] = [];
    let lastResult: TestResult | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // AC-2: acquire a context — blocks if pool is saturated
      // GAP-2: If acquire() rejects (e.g. pool.close() called mid-run), record
      // the test as failed and let the overall run() continue.
      // AC-4: Each retry acquires a fresh context (pool.release calls resetContext).
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
          retries: effectiveRetries > 0 ? effectiveRetries : undefined,
          attempts: attempts.length > 0 ? attempts : undefined,
        };
      }

      try {
        // B-2: Clear the timeout timer after Promise.race resolves or rejects to
        // prevent timer leaks.
        let timerId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timerId = setTimeout(
            () => {
              // AC-11: Cancel any in-flight Page polling (waitForSelector loops)
              // before the context is returned to the pool, so the stale coroutine
              // does not issue evaluate calls against the recycled context.
              ctx._cancel?.();
              reject(new TimeoutError(`Test "${test.name}" timed out after ${timeout}ms`));
            },
            timeout,
          );
        });

        try {
          // Race the test function against a timeout
          await Promise.race([test.fn(ctx), timeoutPromise]);
        } finally {
          clearTimeout(timerId);
        }

        // Test passed — return success result
        lastResult = {
          id: test.id,
          name: test.name,
          status: "passed",
          durationMs: Date.now() - start,
          retries: effectiveRetries > 0 ? effectiveRetries : undefined,
          attempts: attempts.length > 0 ? attempts : undefined,
        };
        return lastResult;
      } catch (err: unknown) {
        const isTimeout = err instanceof TimeoutError;
        const errMessage = err instanceof Error ? err.message : String(err);

        // Record this attempt's error message (AC-3) — only when retries are configured
        if (effectiveRetries > 0) {
          attempts.push(errMessage);
        }

        // AC-1/AC-5/AC-6: best-effort screenshot on final failure or timeout
        let screenshotPath: string | undefined;
        const isFinalAttempt = attempt === maxAttempts;
        if (isFinalAttempt && this.screenshotEnabled) {
          screenshotPath = await this._captureScreenshot(test.name, test.id, ctx.adapterId, ctx.contextId);
        }

        lastResult = {
          id: test.id,
          name: test.name,
          status: isTimeout ? "timedOut" : "failed",
          durationMs: Date.now() - start,
          error: errMessage,
          screenshotPath,
          retries: effectiveRetries > 0 ? effectiveRetries : undefined,
          attempts: attempts.length > 0 ? [...attempts] : undefined,
        };
      } finally {
        // AC-2 & AC-6: always release so the context goes back to the pool
        // release() calls resetContext — AC-4: fresh context for next attempt
        this.pool.release(ctx);
      }
    }

    return lastResult!;
  }

  // -------------------------------------------------------------------------
  // Private: AC-1 screenshot capture
  // -------------------------------------------------------------------------

  /**
   * Capture a PNG screenshot and save it to .kaze/screenshots/<sanitized-name>-<testId>-<timestamp>.png.
   * Returns the saved path, or undefined if capture fails (best-effort, AC-5).
   */
  private async _captureScreenshot(
    testName: string,
    testId: string,
    adapterId: string,
    contextId: string,
  ): Promise<string | undefined> {
    try {
      const adapter = this.pool.getAdapter(adapterId);
      if (!adapter.screenshot) return undefined;

      const pngBuffer = await adapter.screenshot(contextId);

      // AC-2: sanitize test name (replace characters not safe for filenames with '-')
      // AC-9/AC-10: enforce uniqueness with testId and cap length to avoid ENAMETOOLONG
      let safeName = testName
        .replace(/[^a-zA-Z0-9_\-.]/g, "-")
        .slice(0, 200);
      if (!safeName || safeName.replace(/-/g, "").length === 0) {
        safeName = "unnamed";
      }
      const timestamp = Date.now();
      const filename = `${safeName}-${testId}-${timestamp}.png`;
      const screenshotsDir = this._screenshotsDir;

      await fs.mkdir(screenshotsDir, { recursive: true });
      const filePath = path.join(screenshotsDir, filename);
      await fs.writeFile(filePath, pngBuffer);

      return filePath;
    } catch {
      // AC-5: screenshot failure must not affect test result
      return undefined;
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
      const raw = await fs.readFile(this._lastRunPath, "utf-8");
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

      await fs.mkdir(this._lastRunDir, { recursive: true });
      await fs.writeFile(this._lastRunPath, JSON.stringify(data, null, 2), "utf-8");
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
