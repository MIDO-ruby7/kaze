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

describe("test()", () => {
  beforeEach(() => {
    _resetRegistry();
  });

  it("registers a test that is returned by collectTestCases", () => {
    test("my test", async (_page) => {});
    const adapter = makeAdapter();
    const cases = collectTestCases(adapter);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.name).toBe("my test");
  });

  it("clears registry after collectTestCases", () => {
    test("once", async (_page) => {});
    const adapter = makeAdapter();
    const cases1 = collectTestCases(adapter);
    const cases2 = collectTestCases(adapter);
    expect(cases1).toHaveLength(1);
    expect(cases2).toHaveLength(0);
  });

  it("test.describe prefixes test names", () => {
    test.describe("Suite A", () => {
      test("test 1", async (_page) => {});
      test("test 2", async (_page) => {});
    });
    const cases = collectTestCases(makeAdapter());
    expect(cases[0]!.name).toBe("Suite A > test 1");
    expect(cases[1]!.name).toBe("Suite A > test 2");
  });

  it("nested describe produces compound names", () => {
    test.describe("Outer", () => {
      test.describe("Inner", () => {
        test("deep", async (_page) => {});
      });
    });
    const cases = collectTestCases(makeAdapter());
    expect(cases[0]!.name).toBe("Outer > Inner > deep");
  });

  it("collectTestCases returns TestCase with fn that receives a Page", async () => {
    let received: unknown;
    test("page test", async (page) => {
      received = page;
    });

    const adapter = makeAdapter();
    const cases = collectTestCases(adapter);
    expect(cases).toHaveLength(1);

    const ctx: PooledContext = { contextId: "ctx-1", adapterId: "a-1" };
    await cases[0]!.fn(ctx);

    expect(received).toBeInstanceOf(Page);
  });

  it("test.skip does not register the test", () => {
    test.skip("skipped", async (_page) => {});
    const cases = collectTestCases(makeAdapter());
    expect(cases).toHaveLength(0);
  });

  it("assigns unique ids to each test", () => {
    test("a", async (_page) => {});
    test("b", async (_page) => {});
    const cases = collectTestCases(makeAdapter());
    expect(cases[0]!.id).not.toBe(cases[1]!.id);
  });
});
