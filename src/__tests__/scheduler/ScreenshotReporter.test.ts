/**
 * Unit tests for reporter.ts screenshot path display (AC-3).
 *
 * AC-3: verbose reporter prints the screenshot path below the failure line.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import { report } from "../../cli/reporter.js";
import type { TestResult } from "../../scheduler/types.js";

describe("Reporter: screenshot path display (AC-3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints screenshot path for failed test in verbose mode", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    });

    const results: TestResult[] = [
      {
        id: "f1",
        name: "Failing test",
        status: "failed",
        durationMs: 100,
        error: "assertion error",
        screenshotPath: "/project/.kaze/screenshots/Failing-test-1234567890.png",
      },
    ];

    report(results, "verbose");

    const screenshotLine = lines.find((l) => l.includes("screenshot:"));
    expect(screenshotLine).toBeDefined();
    expect(screenshotLine).toContain("/project/.kaze/screenshots/Failing-test-1234567890.png");
  });

  it("prints screenshot path for timedOut test in verbose mode", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    });

    const results: TestResult[] = [
      {
        id: "t1",
        name: "Timeout test",
        status: "timedOut",
        durationMs: 30000,
        error: "timed out after 30000ms",
        screenshotPath: "/project/.kaze/screenshots/Timeout-test-9999999999.png",
      },
    ];

    report(results, "verbose");

    const screenshotLine = lines.find((l) => l.includes("screenshot:"));
    expect(screenshotLine).toBeDefined();
    expect(screenshotLine).toContain("/project/.kaze/screenshots/Timeout-test-9999999999.png");
  });

  it("does NOT print screenshot line when screenshotPath is absent", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    });

    const results: TestResult[] = [
      {
        id: "f2",
        name: "Failed no screenshot",
        status: "failed",
        durationMs: 50,
        error: "error without screenshot",
      },
    ];

    report(results, "verbose");

    const screenshotLine = lines.find((l) => l.includes("screenshot:"));
    expect(screenshotLine).toBeUndefined();
  });

  it("does NOT print screenshot line for passing tests", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    });

    const results: TestResult[] = [
      {
        id: "p1",
        name: "Passing test",
        status: "passed",
        durationMs: 42,
      },
    ];

    report(results, "verbose");

    const screenshotLine = lines.find((l) => l.includes("screenshot:"));
    expect(screenshotLine).toBeUndefined();
  });
});
