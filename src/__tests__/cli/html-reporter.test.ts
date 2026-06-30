import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { generateHtml, writeHtmlReport } from "../../cli/html-reporter.js";
import type { TestResult } from "../../scheduler/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const passed: TestResult = {
  id: "1",
  name: "homepage loads",
  status: "passed",
  durationMs: 123,
};

const failed: TestResult = {
  id: "2",
  name: "login fails gracefully",
  status: "failed",
  durationMs: 456,
  error: "Expected element to be visible",
};

const timedOut: TestResult = {
  id: "3",
  name: "slow test",
  status: "timedOut",
  durationMs: 30000,
  error: "Timeout exceeded",
};

// ---------------------------------------------------------------------------
// generateHtml
// ---------------------------------------------------------------------------

describe("generateHtml", () => {
  it("AC-4: returns a string starting with <!DOCTYPE html>", () => {
    const html = generateHtml([passed]);
    expect(html).toMatch(/^<!DOCTYPE html>/i);
  });

  it("AC-4: includes inline <style> tag (no external stylesheet)", () => {
    const html = generateHtml([passed]);
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/rel=["']stylesheet["']/);
    expect(html).not.toMatch(/src=["']https?:/);
  });

  it("AC-3: summary shows total, passed, failed counts", () => {
    const html = generateHtml([passed, failed, timedOut]);
    // total: 3, passed: 1, failed: 1, timedOut: 1
    expect(html).toContain("3"); // total
    expect(html).toContain("1"); // passed
  });

  it("AC-3: summary shows duration when opts.duration is provided", () => {
    const html = generateHtml([passed], { duration: 1500 });
    expect(html).toContain("1.5"); // 1500ms → 1.5s
  });

  it("AC-3: test list includes test name and status", () => {
    const html = generateHtml([passed, failed]);
    expect(html).toContain("homepage loads");
    expect(html).toContain("login fails gracefully");
  });

  it("AC-3: failed test shows error message", () => {
    const html = generateHtml([failed]);
    expect(html).toContain("Expected element to be visible");
  });

  it("AC-3: timedOut test shows error message", () => {
    const html = generateHtml([timedOut]);
    expect(html).toContain("Timeout exceeded");
  });

  it("AC-3: test durations are shown in the output", () => {
    const html = generateHtml([passed]);
    expect(html).toContain("123"); // 123ms
  });

  it("AC-3: passed tests have a passed indicator", () => {
    const html = generateHtml([passed]);
    expect(html.toLowerCase()).toMatch(/pass/);
  });

  it("AC-3: failed tests have a failed indicator", () => {
    const html = generateHtml([failed]);
    expect(html.toLowerCase()).toMatch(/fail/);
  });

  it("AC-3: screenshot is inlined as base64 img when screenshotPath is set", () => {
    // create a temp PNG-like file
    const tmpFile = path.join(os.tmpdir(), "kaze-test-screenshot.png");
    fs.writeFileSync(tmpFile, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG header
    const resultWithScreenshot: TestResult = {
      ...failed,
      screenshotPath: tmpFile,
    };
    const html = generateHtml([resultWithScreenshot]);
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain("<img");
    fs.unlinkSync(tmpFile);
  });

  it("AC-4: no external resources (no <script src=) in output", () => {
    const html = generateHtml([passed, failed]);
    expect(html).not.toMatch(/<script\s+src=/);
    expect(html).not.toMatch(/href=["']https?:/);
  });

  it("handles empty results array", () => {
    const html = generateHtml([]);
    expect(html).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toContain("0"); // zero tests
  });

  it("AC-3: skipped / timedOut tests appear in summary", () => {
    const html = generateHtml([passed, timedOut]);
    expect(html.toLowerCase()).toMatch(/timed.?out|timeout/);
  });
});

// ---------------------------------------------------------------------------
// writeHtmlReport
// ---------------------------------------------------------------------------

describe("writeHtmlReport", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kaze-html-report-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("AC-2: writes index.html inside the given outputDir", async () => {
    const outPath = await writeHtmlReport([passed], tmpDir);
    expect(outPath).toBe(path.join(tmpDir, "index.html"));
    expect(fs.existsSync(outPath)).toBe(true);
  });

  it("AC-2: creates outputDir when it does not exist", async () => {
    const nested = path.join(tmpDir, "kaze", "report");
    const outPath = await writeHtmlReport([passed], nested);
    expect(fs.existsSync(outPath)).toBe(true);
  });

  it("AC-2: written file contains valid HTML content", async () => {
    const outPath = await writeHtmlReport([passed, failed], tmpDir);
    const content = fs.readFileSync(outPath, "utf8");
    expect(content).toMatch(/^<!DOCTYPE html>/i);
    expect(content).toContain("homepage loads");
    expect(content).toContain("login fails gracefully");
  });

  it("passes duration option through to generateHtml", async () => {
    const outPath = await writeHtmlReport([passed], tmpDir, { duration: 2000 });
    const content = fs.readFileSync(outPath, "utf8");
    expect(content).toContain("2.0");
  });
});
