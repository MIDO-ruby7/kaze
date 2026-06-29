/**
 * Unit tests for test() registration API (AC-4).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { Page } from "../../api/Page.js";
import { test, collectTestCases, _resetRegistry } from "../../api/test.js";
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
  beforeEach(() => {
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
