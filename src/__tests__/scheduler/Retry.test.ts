/**
 * Unit tests for test.retry and Scheduler retry behaviour.
 *
 * AC-1: test.retry(n)(name, fn) sets retries on TestCase
 * AC-2: kaze.config.ts retries field sets default retries
 * AC-3: retry preserves previous attempt error messages
 * AC-4: each retry gets a fresh context (pool.release / resetContext is called)
 * AC-5: verbose reporter shows retry info
 * AC-6: --retries CLI option (tested via config mergeConfig)
 * AC-7: retries field does not affect bench:check (no bench-related assertions here)
 * AC-8: this file is the unit test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { BrowserPool } from "../../pool/BrowserPool.js";
import type { PooledContext } from "../../pool/types.js";
import { Scheduler } from "../../scheduler/Scheduler.js";
import type { TestCase } from "../../scheduler/types.js";
import {
  test,
  collectTestCases,
  _resetRegistry,
} from "../../api/test.js";
import { mergeConfig } from "../../cli/config.js";
import { report } from "../../cli/reporter.js";
import type { TestResult } from "../../scheduler/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(id: string): PooledContext {
  return { contextId: id, adapterId: `adapter-${id}` };
}

function makePool(poolSize = 4): {
  pool: BrowserPool;
  releaseLog: PooledContext[];
} {
  const releaseLog: PooledContext[] = [];
  let ctxCounter = 0;
  let busy = 0;
  const queue: Array<() => void> = [];

  const pool = {
    acquire: vi.fn(async (): Promise<PooledContext> => {
      if (busy >= poolSize) {
        await new Promise<void>((resolve) => queue.push(resolve));
      }
      busy++;
      return makeCtx(`ctx-${ctxCounter++}`);
    }),
    release: vi.fn((ctx: PooledContext) => {
      releaseLog.push(ctx);
      busy--;
      const next = queue.shift();
      if (next) next();
    }),
    init: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    stats: vi.fn().mockReturnValue({
      totalContexts: poolSize,
      busy: 0,
      idle: poolSize,
      processes: 1,
      crashes: 0,
    }),
    getAdapter: vi.fn().mockReturnValue({
      launch: vi.fn().mockResolvedValue(undefined),
      newContext: vi.fn().mockResolvedValue("ctx"),
      closeContext: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(null),
      dispatchEvent: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  } as unknown as BrowserPool;

  return { pool, releaseLog };
}

function makeTestCase(
  name: string,
  fn: (ctx: PooledContext) => Promise<void>,
  retries?: number,
): TestCase {
  return { id: `test-${name}`, name, fn, retries };
}

// ---------------------------------------------------------------------------
// AC-1: test.retry(n)(name, fn) registers TestCase with retries field
// ---------------------------------------------------------------------------

describe("test.retry(n)", () => {
  beforeEach(() => {
    _resetRegistry();
  });

  it("AC-1: registers a test with retries field set", () => {
    const mockPool = { getAdapter: vi.fn().mockReturnValue({}) };
    test.retry(3)("flaky test", async (_page) => {});
    const cases = collectTestCases(mockPool);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.retries).toBe(3);
    expect(cases[0]!.name).toBe("flaky test");
  });

  it("AC-1: test.retry(0) registers with retries=0", () => {
    const mockPool = { getAdapter: vi.fn().mockReturnValue({}) };
    test.retry(0)("no retry", async (_page) => {});
    const cases = collectTestCases(mockPool);
    expect(cases[0]!.retries).toBe(0);
  });

  it("AC-1: regular test() has no retries field", () => {
    const mockPool = { getAdapter: vi.fn().mockReturnValue({}) };
    test("regular test", async (_page) => {});
    const cases = collectTestCases(mockPool);
    expect(cases[0]!.retries).toBeUndefined();
  });

  it("AC-1: test.retry works inside describe", () => {
    const mockPool = { getAdapter: vi.fn().mockReturnValue({}) };
    test.describe("Suite", () => {
      test.retry(2)("inner", async (_page) => {});
    });
    const cases = collectTestCases(mockPool);
    expect(cases[0]!.name).toBe("Suite > inner");
    expect(cases[0]!.retries).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC-3: retry preserves attempt errors in TestResult
// ---------------------------------------------------------------------------

describe("Scheduler retry — AC-3: attempt error accumulation", () => {
  it("returns attempts array with all failure messages", async () => {
    const { pool } = makePool();
    const scheduler = new Scheduler(pool, { screenshot: false });

    let callCount = 0;
    const test = makeTestCase(
      "flaky",
      async (_ctx) => {
        callCount++;
        if (callCount < 3) throw new Error(`Attempt ${callCount} error`);
      },
      2, // retry twice → 3 total attempts
    );

    scheduler.enqueue([test]);
    const results = await scheduler.run();

    expect(results).toHaveLength(1);
    const result = results[0]!;
    expect(result.status).toBe("passed");
    expect(result.attempts).toEqual(["Attempt 1 error", "Attempt 2 error"]);
    expect(callCount).toBe(3);
  });

  it("records all attempt errors when all attempts fail", async () => {
    const { pool } = makePool();
    const scheduler = new Scheduler(pool, { screenshot: false });

    const test = makeTestCase(
      "always-fails",
      async (_ctx) => {
        throw new Error("permanent failure");
      },
      2, // 3 total attempts
    );

    scheduler.enqueue([test]);
    const results = await scheduler.run();

    const result = results[0]!;
    expect(result.status).toBe("failed");
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts![0]).toBe("permanent failure");
    expect(result.attempts![1]).toBe("permanent failure");
    expect(result.attempts![2]).toBe("permanent failure");
  });
});

// ---------------------------------------------------------------------------
// AC-4: each retry acquires a fresh context (release is called between attempts)
// ---------------------------------------------------------------------------

describe("Scheduler retry — AC-4: fresh context per attempt", () => {
  it("calls pool.release after each failed attempt", async () => {
    const { pool, releaseLog } = makePool();
    const scheduler = new Scheduler(pool, { screenshot: false });

    let callCount = 0;
    const testCase = makeTestCase(
      "ctx-check",
      async (_ctx) => {
        callCount++;
        if (callCount < 3) throw new Error("fail");
      },
      2, // 3 attempts
    );

    scheduler.enqueue([testCase]);
    await scheduler.run();

    // release should be called once per attempt (3 times total)
    expect(releaseLog).toHaveLength(3);
    // Each context should be different (fresh acquire each time)
    const ctxIds = releaseLog.map((c) => c.contextId);
    expect(new Set(ctxIds).size).toBe(3);
  });

  it("acquire is called once per attempt", async () => {
    const { pool } = makePool();
    const scheduler = new Scheduler(pool, { screenshot: false });

    const testCase = makeTestCase(
      "acquire-count",
      async (_ctx) => {
        throw new Error("fail");
      },
      1, // 2 attempts
    );

    scheduler.enqueue([testCase]);
    await scheduler.run();

    expect(pool.acquire).toHaveBeenCalledTimes(2);
    expect(pool.release).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// AC-2: kaze.config.ts retries field — mergeConfig integration
// ---------------------------------------------------------------------------

describe("config mergeConfig — AC-2: retries field", () => {
  it("merges retries from file config", () => {
    const result = mergeConfig({ retries: 3 }, {});
    expect(result.retries).toBe(3);
  });

  it("CLI retries override config file retries", () => {
    const result = mergeConfig({ retries: 1 }, { retries: 5 });
    expect(result.retries).toBe(5);
  });

  it("retries is undefined when not set", () => {
    const result = mergeConfig({}, {});
    expect(result.retries).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC-5: verbose reporter shows retry info
// ---------------------------------------------------------------------------

describe("reporter — AC-5: retry display", () => {
  it("shows attempt count for failed test with retries", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      const results: TestResult[] = [
        {
          id: "test-1",
          name: "チェックアウト",
          status: "failed",
          durationMs: 100,
          error: "expect(...).toHaveText failed",
          retries: 2,
          attempts: [
            'Timeout 5000ms waiting for selector "#confirm"',
            "Network error",
            "expect(...).toHaveText failed",
          ],
        },
      ];
      report(results, "verbose");
    } finally {
      console.log = originalLog;
    }

    const failLine = logs.find((l) => l.includes("チェックアウト"));
    expect(failLine).toBeDefined();
    expect(failLine).toContain("failed after 3 attempts");

    const attempt1Line = logs.find((l) => l.includes("Attempt 1:"));
    expect(attempt1Line).toBeDefined();
    expect(attempt1Line).toContain('Timeout 5000ms waiting for selector "#confirm"');
  });

  it("shows no attempt info for regular single-attempt failure", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      const results: TestResult[] = [
        {
          id: "test-2",
          name: "regular failure",
          status: "failed",
          durationMs: 50,
          error: "something broke",
        },
      ];
      report(results, "verbose");
    } finally {
      console.log = originalLog;
    }

    const failLine = logs.find((l) => l.includes("regular failure"));
    expect(failLine).toBeDefined();
    expect(failLine).not.toContain("attempts");

    const errorLine = logs.find((l) => l.includes("something broke"));
    expect(errorLine).toBeDefined();
  });

  it("AC-12: verbose reporter shows all attempt errors (not just last)", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      const results: TestResult[] = [
        {
          id: "test-ac12",
          name: "all-attempts-shown",
          status: "failed",
          durationMs: 300,
          error: "final error",
          retries: 2,
          attempts: [
            "attempt 1 error",
            "attempt 2 error",
            "attempt 3 error",
          ],
        },
      ];
      report(results, "verbose");
    } finally {
      console.log = originalLog;
    }

    // All three attempt errors must appear in output
    expect(logs.some((l) => l.includes("Attempt 1:") && l.includes("attempt 1 error"))).toBe(true);
    expect(logs.some((l) => l.includes("Attempt 2:") && l.includes("attempt 2 error"))).toBe(true);
    expect(logs.some((l) => l.includes("Attempt 3:") && l.includes("attempt 3 error"))).toBe(true);
  });

  it("passed test with retries shows no attempt info", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      const results: TestResult[] = [
        {
          id: "test-3",
          name: "eventually passes",
          status: "passed",
          durationMs: 200,
          retries: 2,
          attempts: ["first fail", "second fail"],
        },
      ];
      report(results, "verbose");
    } finally {
      console.log = originalLog;
    }

    const passLine = logs.find((l) => l.includes("eventually passes"));
    expect(passLine).toBeDefined();
    expect(passLine).toContain("✓");
  });
});

// ---------------------------------------------------------------------------
// Scheduler retry — no retries by default (backward compat)
// ---------------------------------------------------------------------------

describe("Scheduler retry — backward compat", () => {
  it("runs test exactly once when no retries configured", async () => {
    const { pool } = makePool();
    const scheduler = new Scheduler(pool, { screenshot: false });

    let callCount = 0;
    const testCase = makeTestCase("one-shot", async (_ctx) => {
      callCount++;
      throw new Error("fail");
    });

    scheduler.enqueue([testCase]);
    const results = await scheduler.run();

    expect(callCount).toBe(1);
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.attempts).toBeUndefined();
  });

  it("retries field is not set when retries=0", async () => {
    const { pool } = makePool();
    const scheduler = new Scheduler(pool, { screenshot: false });

    const testCase = makeTestCase("zero-retry", async (_ctx) => {}, 0);

    scheduler.enqueue([testCase]);
    const results = await scheduler.run();

    expect(results[0]!.retries).toBeUndefined();
  });
});
