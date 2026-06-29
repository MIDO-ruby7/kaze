/**
 * Unit tests for test.only / test.skip / test.describe.only / test.describe.skip
 * AC-1, AC-2, AC-3, AC-4 of Issue #25
 */

import { describe, it, expect, beforeEach as vitestBeforeEach } from "vitest";

import { Page } from "../../api/Page.js";
import {
  test,
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

function makePool(adapter?: ProtocolAdapter): { getAdapter: (id: string) => ProtocolAdapter } {
  const a = adapter ?? makeAdapter();
  return { getAdapter: () => a };
}

import { vi } from "vitest";

const ctx: PooledContext = { contextId: "ctx-1", adapterId: "a-1" };

describe("test.only (AC-1)", () => {
  vitestBeforeEach(() => {
    _resetRegistry();
  });

  it("when test.only is used, only that test runs (others are excluded)", () => {
    test("normal 1", async (_page) => {});
    test.only("only test", async (_page) => {});
    test("normal 2", async (_page) => {});

    const cases = collectTestCases(makePool());
    expect(cases).toHaveLength(1);
    expect(cases[0]!.name).toBe("only test");
  });

  it("multiple test.only calls: all only tests run", () => {
    test("normal", async (_page) => {});
    test.only("only 1", async (_page) => {});
    test.only("only 2", async (_page) => {});

    const cases = collectTestCases(makePool());
    expect(cases).toHaveLength(2);
    expect(cases.map((c) => c.name)).toEqual(["only 1", "only 2"]);
  });

  it("test.only in describe block uses prefixed name", () => {
    test.describe("Suite", () => {
      test("normal", async (_page) => {});
      test.only("only", async (_page) => {});
    });

    const cases = collectTestCases(makePool());
    expect(cases).toHaveLength(1);
    expect(cases[0]!.name).toBe("Suite > only");
  });

  it("test.only without any normal tests: only that test runs", () => {
    test.only("solo", async (_page) => {});

    const cases = collectTestCases(makePool());
    expect(cases).toHaveLength(1);
    expect(cases[0]!.name).toBe("solo");
  });

  it("no test.only: all normal tests run", () => {
    test("a", async (_page) => {});
    test("b", async (_page) => {});

    const cases = collectTestCases(makePool());
    expect(cases).toHaveLength(2);
  });
});

describe("test.describe.only (AC-2)", () => {
  vitestBeforeEach(() => {
    _resetRegistry();
  });

  it("test.describe.only runs all tests inside the block, excluding others", () => {
    test("outside", async (_page) => {});
    test.describe.only("OnlySuite", () => {
      test("inside 1", async (_page) => {});
      test("inside 2", async (_page) => {});
    });

    const cases = collectTestCases(makePool());
    expect(cases).toHaveLength(2);
    expect(cases.map((c) => c.name)).toEqual([
      "OnlySuite > inside 1",
      "OnlySuite > inside 2",
    ]);
  });

  it("test.describe.only with nested describe", () => {
    test("outside", async (_page) => {});
    test.describe.only("Outer", () => {
      test.describe("Inner", () => {
        test("deep", async (_page) => {});
      });
      test("shallow", async (_page) => {});
    });

    const cases = collectTestCases(makePool());
    expect(cases).toHaveLength(2);
    expect(cases.map((c) => c.name)).toContain("Outer > shallow");
    expect(cases.map((c) => c.name)).toContain("Outer > Inner > deep");
  });

  it("test.describe.only mixed with test.only: both are included", () => {
    test.only("solo only", async (_page) => {});
    test.describe.only("Suite", () => {
      test("in suite", async (_page) => {});
    });
    test("excluded", async (_page) => {});

    const cases = collectTestCases(makePool());
    expect(cases).toHaveLength(2);
    expect(cases.map((c) => c.name)).toContain("solo only");
    expect(cases.map((c) => c.name)).toContain("Suite > in suite");
  });
});

describe("test.skip (AC-3)", () => {
  vitestBeforeEach(() => {
    _resetRegistry();
  });

  it("test.skip does not register the test", () => {
    test.skip("skipped", async (_page) => {});
    const cases = collectTestCases(makePool());
    expect(cases).toHaveLength(0);
  });

  it("test.skip and normal test: only normal runs", () => {
    test("normal", async (_page) => {});
    test.skip("skipped", async (_page) => {});

    const cases = collectTestCases(makePool());
    expect(cases).toHaveLength(1);
    expect(cases[0]!.name).toBe("normal");
  });
});

describe("test.describe.skip (AC-4)", () => {
  vitestBeforeEach(() => {
    _resetRegistry();
  });

  it("test.describe.skip skips all tests in the block", () => {
    test("outside", async (_page) => {});
    test.describe.skip("SkipSuite", () => {
      test("inside 1", async (_page) => {});
      test("inside 2", async (_page) => {});
    });

    const cases = collectTestCases(makePool());
    expect(cases).toHaveLength(1);
    expect(cases[0]!.name).toBe("outside");
  });

  it("test.describe.skip with nested describe: all nested tests skipped", () => {
    test.describe.skip("Outer", () => {
      test.describe("Inner", () => {
        test("deep", async (_page) => {});
      });
      test("shallow", async (_page) => {});
    });

    const cases = collectTestCases(makePool());
    expect(cases).toHaveLength(0);
  });
});
