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
    await pool.init({ maxProcesses: 2, maxContextsPerProcess: 2 });

    const s = pool.stats();
    expect(s.processes).toBe(2);
    expect(s.totalContexts).toBe(4);
    expect(s.idle).toBe(4);
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

    // Release ctx1 → pending acquire resolves
    pool.release(ctx1);
    const ctx2 = await pendingAcquire;
    expect(resolved).toBe(true);
    expect(ctx2.contextId).toBe(ctx1.contextId);

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
