/**
 * Unit tests for BrowserPool.
 *
 * These tests mock the ProtocolAdapter so no real Chromium process is needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { BrowserPool } from "../../pool/BrowserPool.js";

// ---------------------------------------------------------------------------
// Mock the protocol/index.js createAdapter factory
// ---------------------------------------------------------------------------

// We track adapters created so we can control them per-test.
interface MockAdapter {
  launch: ReturnType<typeof vi.fn>;
  newContext: ReturnType<typeof vi.fn>;
  closeContext: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  dispatchEvent: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  /** Simulate a crash — make all subsequent evaluate calls throw. */
  simulateCrash: () => void;
}

let createdAdapters: MockAdapter[] = [];
let adapterSeq = 0;

function makeMockAdapter(): MockAdapter {
  let crashed = false;
  let ctxSeq = 0;

  const adapter: MockAdapter = {
    launch: vi.fn().mockResolvedValue(undefined),
    newContext: vi.fn().mockImplementation(() => {
      if (crashed) return Promise.reject(new Error("adapter crashed"));
      return Promise.resolve(`ctx-${adapterSeq}-${ctxSeq++}`);
    }),
    closeContext: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockImplementation(() => {
      if (crashed) return Promise.reject(new Error("adapter crashed"));
      return Promise.resolve(1);
    }),
    dispatchEvent: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    simulateCrash: () => {
      crashed = true;
    },
  };
  return adapter;
}

vi.mock("../../protocol/index.js", () => ({
  createAdapter: vi.fn(() => {
    const adapter = makeMockAdapter();
    adapterSeq++;
    createdAdapters.push(adapter);
    return adapter;
  }),
}));

// Mock probeHostResources and computePoolSizing for deterministic sizing.
vi.mock("../../pool/resources.js", () => ({
  probeHostResources: vi.fn(() => ({
    totalMemMB: 4096,
    freeMemMB: 4096,
    cpuCount: 4,
  })),
}));

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  createdAdapters = [];
  adapterSeq = 0;
});

afterEach(async () => {
  // Vitest fake timers may not be active, but reset module mocks if needed
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// AC-1: init
// ---------------------------------------------------------------------------

describe("AC-1: init()", () => {
  it("launches Chromium processes based on sizing and creates contexts", async () => {
    const pool = new BrowserPool();
    // maxProcesses=2 is an upper bound — actual count depends on CPU/RAM heuristic
    await pool.init({ maxProcesses: 2, maxContextsPerProcess: 2 });

    const s = pool.stats();
    expect(s.processes).toBeGreaterThanOrEqual(1);
    expect(s.processes).toBeLessThanOrEqual(2);
    expect(s.totalContexts).toBeGreaterThanOrEqual(1);
    expect(s.idle).toBe(s.totalContexts);
    expect(s.busy).toBe(0);

    await pool.close();
  });

  it("respects maxProcesses=1, maxContextsPerProcess=3", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 3 });

    const s = pool.stats();
    expect(s.processes).toBe(1);
    expect(s.totalContexts).toBe(3);

    await pool.close();
  });

  it("throws if called after close()", async () => {
    const pool = new BrowserPool();
    await pool.close();
    await expect(pool.init({ maxProcesses: 1, maxContextsPerProcess: 1 })).rejects.toThrow(
      "closed",
    );
  });
});

// ---------------------------------------------------------------------------
// AC-2: acquire / release
// ---------------------------------------------------------------------------

describe("AC-2: acquire() / release()", () => {
  it("returns a PooledContext with contextId and adapterId", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 2 });

    const ctx = await pool.acquire();
    expect(ctx).toHaveProperty("contextId");
    expect(ctx).toHaveProperty("adapterId");
    expect(pool.stats().busy).toBe(1);
    expect(pool.stats().idle).toBe(1);

    pool.release(ctx);
    // Approach B: immediately after release the context is "replacing" (counted as busy)
    expect(pool.stats().busy).toBe(1);

    // After replacement completes, it becomes idle again
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(pool.stats().busy).toBe(0);
    expect(pool.stats().idle).toBe(2);

    await pool.close();
  });

  it("FIFO wait queue: caller waits when all contexts are busy", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1 });

    const ctx1 = await pool.acquire();
    expect(pool.stats().idle).toBe(0);

    // This acquire should block until ctx1 is released
    let resolved = false;
    const pendingAcquire = pool.acquire().then((c) => {
      resolved = true;
      return c;
    });

    // Not yet resolved
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);

    // Release ctx1 → pending acquire resolves with a fresh context (Approach B)
    pool.release(ctx1);
    const ctx2 = await pendingAcquire;
    expect(resolved).toBe(true);
    // Approach B: waiter gets a NEW contextId (old one was closed and replaced)
    expect(ctx2.contextId).not.toBe(ctx1.contextId);

    pool.release(ctx2);
    await pool.close();
  });

  it("returns PooledContext shape { contextId: string, adapterId: string }", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1 });
    const ctx = await pool.acquire();
    expect(typeof ctx.contextId).toBe("string");
    expect(typeof ctx.adapterId).toBe("string");
    pool.release(ctx);
    // Wait for async context replacement (Approach B) before close
    await new Promise<void>((r) => setTimeout(r, 50));
    await pool.close();
  });

  it("acquire() rejects when pool is closed", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1 });
    await pool.close();
    await expect(pool.acquire()).rejects.toThrow("closed");
  });
});

// ---------------------------------------------------------------------------
// AC-3: close()
// ---------------------------------------------------------------------------

describe("AC-3: close()", () => {
  it("closes all contexts and processes without error", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 2, maxContextsPerProcess: 2 });
    await pool.close();

    // All adapters should have had close() called
    for (const adapter of createdAdapters) {
      expect(adapter.close).toHaveBeenCalled();
    }
  });

  it("is idempotent (calling close() twice does not throw)", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1 });
    await pool.close();
    await expect(pool.close()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC-5: stats()
// ---------------------------------------------------------------------------

describe("AC-5: stats()", () => {
  it("returns correct shape", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 2 });

    const s = pool.stats();
    expect(s).toMatchObject({
      totalContexts: expect.any(Number),
      busy: expect.any(Number),
      idle: expect.any(Number),
      processes: expect.any(Number),
      crashes: expect.any(Number),
    });

    await pool.close();
  });

  it("busy + idle <= totalContexts", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 2, maxContextsPerProcess: 2 });

    const ctx = await pool.acquire();
    const s = pool.stats();
    expect(s.busy + s.idle).toBeLessThanOrEqual(s.totalContexts);

    pool.release(ctx);
    await pool.close();
  });

  it("crashes counter starts at 0", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1 });
    expect(pool.stats().crashes).toBe(0);
    await pool.close();
  });
});

// ---------------------------------------------------------------------------
// B-1: close() rejects pending acquire() promises
// ---------------------------------------------------------------------------

describe("B-1: close() rejects pending acquire()", () => {
  it("pending acquire() rejects with BrowserPool closed error when close() is called", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1 });

    // Exhaust the single context
    const ctx1 = await pool.acquire();

    // This acquire should block because no context is available
    const pendingAcquire = pool.acquire();

    // Close the pool while the acquire is pending
    const closePromise = pool.close();

    // The pending acquire must reject
    await expect(pendingAcquire).rejects.toThrow(/closed/);
    await closePromise;

    // Clean up: release ctx1 after pool is closed (should be a no-op)
    pool.release(ctx1);
  });

  it("close() rejects multiple pending acquire() calls", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1 });

    const ctx1 = await pool.acquire();

    const pending1 = pool.acquire();
    const pending2 = pool.acquire();
    const pending3 = pool.acquire();

    await pool.close();

    await expect(pending1).rejects.toThrow(/closed/);
    await expect(pending2).rejects.toThrow(/closed/);
    await expect(pending3).rejects.toThrow(/closed/);

    pool.release(ctx1);
  });
});

// ---------------------------------------------------------------------------
// B-3 / GAP-2: crash + stale adapterId release() still drains waitQueue
// ---------------------------------------------------------------------------

describe("B-3 / GAP-2: release() with stale adapterId drains waitQueue", () => {
  it("release() with old adapterId after crash still resolves a pending acquire()", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1 });

    // Acquire the only context — keep the old token
    const staleToken = await pool.acquire();

    // Queue a waiter
    let waiterResolved = false;
    const pendingAcquire = pool.acquire().then((c) => {
      waiterResolved = true;
      return c;
    });

    // Not resolved yet
    await new Promise((r) => setTimeout(r, 10));
    expect(waiterResolved).toBe(false);

    // Release with the original token (adapterId unchanged here, but the
    // context should be found and the waiter drained)
    pool.release(staleToken);

    const acquired = await pendingAcquire;
    expect(waiterResolved).toBe(true);
    // Approach B: waiter gets a fresh context, not the same stale one
    expect(acquired.contextId).not.toBe(staleToken.contextId);

    pool.release(acquired);
    await pool.close();
  });

  it("release() with unknown contextId still drains waitQueue when another idle ctx exists", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 2 });

    const ctx1 = await pool.acquire();
    const ctx2 = await pool.acquire();

    // Queue a waiter
    let waiterResolved = false;
    const pendingAcquire = pool.acquire().then((c) => {
      waiterResolved = true;
      return c;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(waiterResolved).toBe(false);

    // Release ctx1 with a completely bogus adapterId — simulates post-crash stale token
    pool.release({ contextId: "non-existent-ctx", adapterId: "adapter-old" });

    // Waiter should NOT be resolved since the stale token doesn't match any idle ctx
    // and the other real context (ctx2) is still busy.
    await new Promise((r) => setTimeout(r, 10));
    expect(waiterResolved).toBe(false);

    // Release real ctx2 → waiter should now resolve
    pool.release(ctx2);
    const acquired = await pendingAcquire;
    expect(waiterResolved).toBe(true);

    pool.release(acquired);
    pool.release(ctx1);
    await pool.close();
  });
});

// ---------------------------------------------------------------------------
// B-2: probe marks ctx as busy during health check
// ---------------------------------------------------------------------------

describe("B-2: probe marks ctx as busy during health check", () => {
  it("should not return a context that is being probed", async () => {
    // We need fine-grained control over evaluate to pause probe mid-flight.
    // Use a deferred promise: probe will call evaluate and hang until we resolve.
    let resolveEvaluate!: (v: number) => void;
    const evaluateLatch = new Promise<number>((res) => {
      resolveEvaluate = res;
    });

    // Track how many times evaluate was called
    let evaluateCallCount = 0;

    vi.useFakeTimers();

    const pool = new BrowserPool();

    try {
      await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1 });

      // Override the evaluate mock on the adapter created during init
      const adapter = createdAdapters[0]!;
      adapter.evaluate.mockImplementation(() => {
        evaluateCallCount++;
        return evaluateLatch; // hangs until we manually resolve
      });

      // Advance fake timers by the PROBE_INTERVAL_MS (500 ms) so probe() fires.
      vi.advanceTimersByTime(500);

      // Give the probe a tick to start executing and call evaluate
      await Promise.resolve();
      await Promise.resolve();

      // evaluate should have been called exactly once (probe is now waiting inside evaluateLatch)
      expect(evaluateCallCount).toBe(1);

      // At this point the context state should be "busy" (probe set it before calling evaluate).
      // acquire() must not return it.
      let acquireResolved = false;
      const pendingAcquire = pool.acquire().then((c) => {
        acquireResolved = true;
        return c;
      });

      // Flush pending microtasks — acquire() should remain pending because the
      // only context is still held by the probe.
      await Promise.resolve();
      await Promise.resolve();
      expect(acquireResolved).toBe(false);

      // Now let probe complete by resolving evaluate.
      resolveEvaluate(1);

      // After probe finishes, the context should return to "idle" and the queued
      // acquire() should be resolved.
      const ctx = await pendingAcquire;
      expect(acquireResolved).toBe(true);
      expect(typeof ctx.contextId).toBe("string");

      pool.release(ctx);
    } finally {
      // Always restore real timers to avoid leaking into subsequent tests.
      vi.useRealTimers();
      await pool.close();
    }
  }, 10_000);
});

// ---------------------------------------------------------------------------
// AC-6 (mock variant): 8 concurrent acquire/release × 50 rounds — no deadlock
// ---------------------------------------------------------------------------

describe("AC-6: concurrency stress (mocked, no real Chromium)", () => {
  it("8 concurrent acquire/release × 50 rounds — no leak or deadlock", async () => {
    const CONCURRENCY = 8;
    const ROUNDS = 50;
    const CONTEXTS = 4; // use fewer contexts to force queuing

    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 2, maxContextsPerProcess: CONTEXTS / 2 });

    const doRound = async (): Promise<void> => {
      const ctx = await pool.acquire();
      // Simulate a tiny bit of work
      await new Promise<void>((r) => setTimeout(r, Math.random() * 2));
      pool.release(ctx);
    };

    for (let round = 0; round < ROUNDS; round++) {
      await Promise.all(Array.from({ length: CONCURRENCY }, () => doRound()));
    }

    const s = pool.stats();
    // After all rounds, everything should be idle
    expect(s.busy).toBe(0);
    expect(s.idle).toBe(s.totalContexts);

    await pool.close();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// AC-14: release() → _onReset called before adapter.resetContext()
// ---------------------------------------------------------------------------

describe("AC-14: release() calls _onReset before adapter.resetContext()", () => {
  it("_onReset is invoked before resetContext when releasing a context", async () => {
    // Build a call-order log so we can assert sequencing.
    const callOrder: string[] = [];

    // Override the mock factory for this test to include resetContext.
    // We cannot reassign the module-level vi.mock, so we manipulate the
    // adapter instance after it is created by the pool.
    const pool = new BrowserPool();
    // prewarm: false so only one resetContext call happens (the regular release reset)
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1, prewarm: false });

    // The adapter created during init is in createdAdapters[last].
    const adapter = createdAdapters[createdAdapters.length - 1]!;

    // Attach a resetContext spy that records its invocation order.
    (adapter as unknown as Record<string, unknown>).resetContext = vi.fn().mockImplementation(() => {
      callOrder.push("resetContext");
      return Promise.resolve();
    });

    // Acquire a context so we can customise _onReset on the PooledContext.
    const ctx = await pool.acquire();

    // Attach the _onReset hook — this is the same hook that Page registers.
    ctx._onReset = vi.fn().mockImplementation(async () => {
      callOrder.push("_onReset");
    });

    // Release the context — BrowserPool should call _onReset then resetContext.
    pool.release(ctx);

    // Wait for the async _replaceContext to complete.
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(ctx._onReset).toHaveBeenCalledTimes(1);
    expect((adapter as unknown as { resetContext: ReturnType<typeof vi.fn> }).resetContext).toHaveBeenCalledTimes(1);

    // The critical ordering assertion: _onReset must precede resetContext.
    expect(callOrder).toEqual(["_onReset", "resetContext"]);

    await pool.close();
  });

  it("release() without _onReset still calls resetContext", async () => {
    const pool = new BrowserPool();
    // prewarm: false so only one resetContext call happens (the regular release reset)
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1, prewarm: false });

    const adapter = createdAdapters[createdAdapters.length - 1]!;
    const resetContextSpy = vi.fn().mockResolvedValue(undefined);
    (adapter as unknown as Record<string, unknown>).resetContext = resetContextSpy;

    const ctx = await pool.acquire();
    // No _onReset set — plain release.
    pool.release(ctx);

    await new Promise<void>((r) => setTimeout(r, 50));

    expect(resetContextSpy).toHaveBeenCalledTimes(1);

    await pool.close();
  });
});

// ---------------------------------------------------------------------------
// Approach B: context replacement on release (test isolation guarantee)
// ---------------------------------------------------------------------------

describe("Context isolation (Approach B: replace context on release)", () => {
  it("release() calls closeContext on the used context", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1 });
    const ctx = await pool.acquire();
    const usedContextId = ctx.contextId;

    const adapter = createdAdapters[createdAdapters.length - 1]!;
    pool.release(ctx);

    // Wait for the async replacement to complete
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(adapter.closeContext).toHaveBeenCalledWith(usedContextId);
    await pool.close();
  });

  it("release() creates a new context to replace the used one", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1 });
    const ctx = await pool.acquire();

    const adapter = createdAdapters[createdAdapters.length - 1]!;
    const callsBefore = (adapter.newContext as ReturnType<typeof vi.fn>).mock.calls.length;

    pool.release(ctx);
    await new Promise<void>((r) => setTimeout(r, 50));

    // One extra newContext() call for the replacement
    expect((adapter.newContext as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore + 1);
    await pool.close();
  });

  it("next acquire() gets a fresh context id (not the same as previous test)", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1 });

    const ctx1 = await pool.acquire();
    const id1 = ctx1.contextId;
    pool.release(ctx1);

    // Wait for replacement to complete
    await new Promise<void>((r) => setTimeout(r, 50));

    const ctx2 = await pool.acquire();
    const id2 = ctx2.contextId;
    pool.release(ctx2);

    expect(id2).not.toBe(id1);
    await pool.close();
  });

  it("waiter receives the freshly-created context after replacement", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1 });

    const ctx1 = await pool.acquire();

    // Queue a waiter before releasing
    const ctx2Promise = pool.acquire();
    pool.release(ctx1);

    const ctx2 = await ctx2Promise;

    // The waiter should get the NEW context id, not ctx1's id
    expect(ctx2.contextId).not.toBe(ctx1.contextId);
    pool.release(ctx2);
    await pool.close();
  });
});

// ---------------------------------------------------------------------------
// AC-1..5 (Issue #37): Context prewarming
// ---------------------------------------------------------------------------

describe("Issue #37: Context prewarming", () => {
  it("AC-2: acquire() returns immediately when a warmed context is available", async () => {
    const pool = new BrowserPool();
    // Attach a resetContext mock so prewarm can run
    const adapter = (() => {
      // Will be set after init
      let _adapter: MockAdapter | undefined;
      return {
        get() { return _adapter; },
        set(a: MockAdapter) { _adapter = a; },
      };
    })();

    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1, prewarm: true });
    const a = createdAdapters[createdAdapters.length - 1]!;
    adapter.set(a);

    // Attach resetContext to track calls
    let resetCount = 0;
    (a as unknown as Record<string, unknown>).resetContext = vi.fn().mockImplementation(() => {
      resetCount++;
      return Promise.resolve();
    });

    // acquire + release to trigger prewarm
    const ctx = await pool.acquire();
    pool.release(ctx);

    // Wait for _replaceContext (regular reset) + warmNext (prewarm) to complete
    await new Promise<void>((r) => setTimeout(r, 100));

    // At this point the context should be "warm" — acquire() must resolve without
    // triggering another resetContext.
    const resetCountBefore = resetCount;
    const ctx2 = await pool.acquire();
    expect(ctx2).toBeDefined();
    // No additional resetContext call should have happened during acquire()
    expect(resetCount).toBe(resetCountBefore);

    pool.release(ctx2);
    await pool.close();
  });

  it("AC-3: prewarm defaults to true — fires an extra resetContext after release", async () => {
    // With prewarm: true (default), after _replaceContext completes a second
    // resetContext is fired to warm the slot for the next acquire().
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1 }); // default prewarm: true

    const a = createdAdapters[createdAdapters.length - 1]!;
    let resetCount = 0;
    (a as unknown as Record<string, unknown>).resetContext = vi.fn().mockImplementation(() => {
      resetCount++;
      return Promise.resolve();
    });

    const ctx = await pool.acquire();
    pool.release(ctx);

    // Wait for _replaceContext (reset 1) + warmNext (reset 2) to complete
    await new Promise<void>((r) => setTimeout(r, 150));

    // 2 resetContext calls: 1 regular + 1 prewarm
    expect(resetCount).toBe(2);

    await pool.close();
  });

  it("AC-3: prewarm: false suppresses the extra prewarm resetContext", async () => {
    // With prewarm: false, no extra resetContext is fired after _replaceContext
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1, prewarm: false });

    const a = createdAdapters[createdAdapters.length - 1]!;
    let resetCount = 0;
    (a as unknown as Record<string, unknown>).resetContext = vi.fn().mockImplementation(() => {
      resetCount++;
      return Promise.resolve();
    });

    const ctx = await pool.acquire();
    pool.release(ctx);

    // Wait for _replaceContext to complete (1 reset) plus extra time for any
    // unwanted prewarm that should NOT happen
    await new Promise<void>((r) => setTimeout(r, 150));

    // Only 1 resetContext call: the regular release reset. No prewarm.
    expect(resetCount).toBe(1);

    await pool.close();
  });

  it("AC-4: prewarm error falls back gracefully — acquire() still succeeds", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1, prewarm: true });

    const a = createdAdapters[createdAdapters.length - 1]!;
    let callCount = 0;
    (a as unknown as Record<string, unknown>).resetContext = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        // Prewarm attempt fails
        return Promise.reject(new Error("prewarm failed"));
      }
      return Promise.resolve();
    });

    const ctx = await pool.acquire();
    pool.release(ctx);

    // Wait for both _replaceContext and failed warmNext to settle
    await new Promise<void>((r) => setTimeout(r, 150));

    // acquire() should still succeed (fallback to normal reset on next acquire)
    const ctx2 = await pool.acquire();
    expect(ctx2).toBeDefined();

    pool.release(ctx2);
    await pool.close();
  });

  it("AC-9: close() awaits in-flight warmPromise before closing adapters", async () => {
    const pool = new BrowserPool();
    await pool.init({ maxProcesses: 1, maxContextsPerProcess: 1, prewarm: true });

    const ctx = await pool.acquire();

    // Give the pool a slow resetContext so warmPromise is in-flight
    // (mock the adapter's resetContext to take 50ms)
    const adapter = createdAdapters[createdAdapters.length - 1]!;
    let warmingDone = false;
    (adapter as unknown as Record<string, unknown>).resetContext = vi.fn().mockImplementation(() =>
      new Promise<void>(r => setTimeout(() => { warmingDone = true; r(); }, 50))
    );

    pool.release(ctx); // starts _warmContext async

    // Close immediately (warmPromise should be in-flight)
    await pool.close();

    // After close, warming should have completed (allSettled awaited it)
    expect(warmingDone).toBe(true);
  });
});
