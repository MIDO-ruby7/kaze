/**
 * Unit tests for test() registration API (AC-4).
 */

import { describe, it, expect, vi, beforeEach as vitestBeforeEach } from "vitest";

import { Page } from "../../api/Page.js";
import {
  test,
  beforeAll as kazeBeforeAll,
  afterAll as kazeAfterAll,
  beforeEach as kazeBeforeEach,
  afterEach as kazeAfterEach,
  collectTestCases,
  _resetRegistry,
} from "../../api/test.js";
import type { PooledContext } from "../../pool/types.js";
import type { ProtocolAdapter } from "../../protocol/index.js";

function makeAdapter(overrides: Partial<ProtocolAdapter> = {}): ProtocolAdapter {
  return {
    launch: vi.fn().mockResolvedValue(undefined),
    newContext: vi.fn().mockResolvedValue("ctx-1"),
    closeContext: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(null),
    dispatchEvent: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Mock pool that wraps a single adapter — satisfies the AdapterResolver interface. */
function makePool(adapter?: ProtocolAdapter): { getAdapter: (id: string) => ProtocolAdapter } {
  const a = adapter ?? makeAdapter();
  return { getAdapter: () => a };
}

describe("test()", () => {
  vitestBeforeEach(() => {
    _resetRegistry();
  });

  it("registers a test that is returned by collectTestCases", () => {
    test("my test", async (_page) => {});
    const cases = collectTestCases(makePool());
    expect(cases).toHaveLength(1);
    expect(cases[0]!.name).toBe("my test");
  });

  it("clears registry after collectTestCases", () => {
    test("once", async (_page) => {});
    const cases1 = collectTestCases(makePool());
    const cases2 = collectTestCases(makePool());
    expect(cases1).toHaveLength(1);
    expect(cases2).toHaveLength(0);
  });

  it("test.describe prefixes test names", () => {
    test.describe("Suite A", () => {
      test("test 1", async (_page) => {});
      test("test 2", async (_page) => {});
    });
    const cases = collectTestCases(makePool());
    expect(cases[0]!.name).toBe("Suite A > test 1");
    expect(cases[1]!.name).toBe("Suite A > test 2");
  });

  it("nested describe produces compound names", () => {
    test.describe("Outer", () => {
      test.describe("Inner", () => {
        test("deep", async (_page) => {});
      });
    });
    const cases = collectTestCases(makePool());
    expect(cases[0]!.name).toBe("Outer > Inner > deep");
  });

  it("collectTestCases returns TestCase with fn that receives a Page", async () => {
    let received: unknown;
    test("page test", async (page) => {
      received = page;
    });

    const cases = collectTestCases(makePool());
    expect(cases).toHaveLength(1);

    const ctx: PooledContext = { contextId: "ctx-1", adapterId: "a-1" };
    await cases[0]!.fn(ctx);

    expect(received).toBeInstanceOf(Page);
  });

  it("test.skip does not register the test", () => {
    test.skip("skipped", async (_page) => {});
    const cases = collectTestCases(makePool());
    expect(cases).toHaveLength(0);
  });

  it("assigns unique ids to each test", () => {
    test("a", async (_page) => {});
    test("b", async (_page) => {});
    const cases = collectTestCases(makePool());
    expect(cases[0]!.id).not.toBe(cases[1]!.id);
  });

  it("GAP-1: error in test fn propagates (pool manages context lifecycle)", async () => {
    test("throws", async (_page) => {
      throw new Error("test error");
    });

    const cases = collectTestCases(makePool());
    const ctx: PooledContext = { contextId: "ctx-1", adapterId: "a-1" };

    await expect(cases[0]!.fn(ctx)).rejects.toThrow("test error");
  });

  it("GAP-1: test fn runs without calling closeContext (pool manages lifecycle)", async () => {
    test("success", async (_page) => {});

    const adapter = makeAdapter();
    const cases = collectTestCases(makePool(adapter));
    const ctx: PooledContext = { contextId: "ctx-1", adapterId: "a-1" };

    await cases[0]!.fn(ctx);
    // pool manages context lifecycle — closeContext is NOT called by collectTestCases
    expect(adapter.closeContext).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

describe("lifecycle hooks", () => {
  const ctx: PooledContext = { contextId: "ctx-1", adapterId: "a-1" };

  it("beforeEach runs before each test", async () => {
    const order: string[] = [];
    kazeBeforeEach(() => { order.push("beforeEach"); });
    test("t1", async () => { order.push("t1"); });
    test("t2", async () => { order.push("t2"); });

    const cases = collectTestCases(makePool());
    for (const c of cases) await c.fn(ctx);

    expect(order).toEqual(["beforeEach", "t1", "beforeEach", "t2"]);
  });

  it("afterEach runs after each test", async () => {
    const order: string[] = [];
    kazeAfterEach(() => { order.push("afterEach"); });
    test("t1", async () => { order.push("t1"); });
    test("t2", async () => { order.push("t2"); });

    const cases = collectTestCases(makePool());
    for (const c of cases) await c.fn(ctx);

    expect(order).toEqual(["t1", "afterEach", "t2", "afterEach"]);
  });

  it("beforeAll runs once before all tests in scope", async () => {
    const order: string[] = [];
    kazeBeforeAll(() => { order.push("beforeAll"); });
    test("t1", async () => { order.push("t1"); });
    test("t2", async () => { order.push("t2"); });

    const cases = collectTestCases(makePool());
    for (const c of cases) await c.fn(ctx);

    expect(order).toEqual(["beforeAll", "t1", "t2"]);
  });

  it("afterAll runs once after all tests in scope", async () => {
    const order: string[] = [];
    kazeAfterAll(() => { order.push("afterAll"); });
    test("t1", async () => { order.push("t1"); });
    test("t2", async () => { order.push("t2"); });

    const cases = collectTestCases(makePool());
    for (const c of cases) await c.fn(ctx);

    expect(order).toEqual(["t1", "t2", "afterAll"]);
  });

  it("hooks in describe scope only apply to tests in that scope", async () => {
    const order: string[] = [];
    test.describe("Suite", () => {
      kazeBeforeEach(() => { order.push("suite:beforeEach"); });
      test("inner", async () => { order.push("inner"); });
    });
    test("outer", async () => { order.push("outer"); });

    const cases = collectTestCases(makePool());
    for (const c of cases) await c.fn(ctx);

    // "Suite > inner": hook runs, then test
    expect(order).toEqual(["suite:beforeEach", "inner", "outer"]);
  });

  it("outer beforeEach runs for inner describe tests too", async () => {
    const order: string[] = [];
    kazeBeforeEach(() => { order.push("outer:beforeEach"); });
    test.describe("Suite", () => {
      kazeBeforeEach(() => { order.push("inner:beforeEach"); });
      test("t", async () => { order.push("t"); });
    });

    const cases = collectTestCases(makePool());
    await cases[0]!.fn(ctx);

    // outer beforeEach runs first, then inner
    expect(order).toEqual(["outer:beforeEach", "inner:beforeEach", "t"]);
  });

  it("afterEach runs even when test throws", async () => {
    const order: string[] = [];
    kazeAfterEach(() => { order.push("afterEach"); });
    test("throws", async () => { throw new Error("fail"); });

    const cases = collectTestCases(makePool());
    await expect(cases[0]!.fn(ctx)).rejects.toThrow("fail");

    expect(order).toEqual(["afterEach"]);
  });
});
