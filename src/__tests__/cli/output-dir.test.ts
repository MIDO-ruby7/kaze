import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Tilde expansion logic (mirrors src/cli/index.ts `outputDir` resolution)
// ---------------------------------------------------------------------------

function resolveOutputDir(rawOutputDir: string | undefined): string {
  return rawOutputDir
    ? path.resolve(rawOutputDir.startsWith("~/")
        ? os.homedir() + rawOutputDir.slice(1)
        : rawOutputDir)
    : path.join(process.cwd(), ".kaze", "report");
}

describe("output-dir tilde expansion", () => {
  it("resolves ~/foo to os.homedir() + '/foo'", () => {
    const result = resolveOutputDir("~/foo");
    expect(result).toBe(path.join(os.homedir(), "foo"));
  });

  it("resolves ~/a/b/c correctly", () => {
    const result = resolveOutputDir("~/a/b/c");
    expect(result).toBe(path.join(os.homedir(), "a", "b", "c"));
  });

  it("does not expand a path that merely contains ~ but does not start with ~/", () => {
    const result = resolveOutputDir("/tmp/some~dir");
    expect(result).toBe(path.resolve("/tmp/some~dir"));
  });

  it("resolves a plain relative path without tilde expansion", () => {
    const result = resolveOutputDir("reports/html");
    expect(result).toBe(path.resolve("reports/html"));
  });

  it("resolves an absolute path unchanged", () => {
    const result = resolveOutputDir("/absolute/path/to/report");
    expect(result).toBe("/absolute/path/to/report");
  });

  it("falls back to .kaze/report under cwd when no output-dir is given", () => {
    const result = resolveOutputDir(undefined);
    expect(result).toBe(path.join(process.cwd(), ".kaze", "report"));
  });
});
