/**
 * Unit tests for --shard CLI option (Issue #29).
 *
 * AC-1: --shard=<index>/<total> splits spec files evenly
 * AC-2: split is file-based (not test-based)
 * AC-3: shard index beyond file count → 0 files, normal exit
 * AC-4: shard can be set in kaze.config.ts
 * AC-5: verbose reporter shows [Shard 1/3] prefix
 * AC-6: unit tests (this file)
 * AC-8: --shard and --watch are mutually exclusive (exit 1)
 * AC-9: out-of-range shard values are caught at CLI level (exit 2)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { shardFiles } from "../../cli/runner.js";
import { loadConfig, mergeConfig } from "../../cli/config.js";
import type { KazeConfig } from "../../cli/config.js";
import { report } from "../../cli/reporter.js";
import type { TestResult } from "../../scheduler/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = path.resolve(__dirname, "../../cli/index.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeTmpFile(dir: string, filename: string, content: string): void {
  const p = path.join(dir, filename);
  fs.writeFileSync(p, content, "utf8");
}

function makeResult(name: string, status: "passed" | "failed" = "passed"): TestResult {
  return { name, status, durationMs: 10 };
}

// ---------------------------------------------------------------------------
// AC-1 / AC-2: shardFiles — file-based even splitting
// ---------------------------------------------------------------------------

describe("shardFiles (AC-1, AC-2)", () => {
  it("returns the correct slice for shard 1/3", () => {
    const files = ["a.spec.ts", "b.spec.ts", "c.spec.ts", "d.spec.ts", "e.spec.ts", "f.spec.ts"];
    // ceil(6/3) = 2, shard 1 → [0..2)
    expect(shardFiles(files, { index: 1, total: 3 })).toEqual(["a.spec.ts", "b.spec.ts"]);
  });

  it("returns the correct slice for shard 2/3", () => {
    const files = ["a.spec.ts", "b.spec.ts", "c.spec.ts", "d.spec.ts", "e.spec.ts", "f.spec.ts"];
    // shard 2 → [2..4)
    expect(shardFiles(files, { index: 2, total: 3 })).toEqual(["c.spec.ts", "d.spec.ts"]);
  });

  it("returns the correct slice for shard 3/3", () => {
    const files = ["a.spec.ts", "b.spec.ts", "c.spec.ts", "d.spec.ts", "e.spec.ts", "f.spec.ts"];
    // shard 3 → [4..6)
    expect(shardFiles(files, { index: 3, total: 3 })).toEqual(["e.spec.ts", "f.spec.ts"]);
  });

  it("handles uneven split — last shard gets fewer files", () => {
    const files = ["a.spec.ts", "b.spec.ts", "c.spec.ts", "d.spec.ts", "e.spec.ts"];
    // ceil(5/3) = 2, shard 3 → [4..6) but only [4..5)
    expect(shardFiles(files, { index: 3, total: 3 })).toEqual(["e.spec.ts"]);
  });

  it("handles shard 1/1 (all files)", () => {
    const files = ["a.spec.ts", "b.spec.ts"];
    expect(shardFiles(files, { index: 1, total: 1 })).toEqual(["a.spec.ts", "b.spec.ts"]);
  });

  it("handles single file shard 1/3", () => {
    const files = ["a.spec.ts"];
    expect(shardFiles(files, { index: 1, total: 3 })).toEqual(["a.spec.ts"]);
  });

  it("handles empty file list", () => {
    expect(shardFiles([], { index: 1, total: 3 })).toEqual([]);
  });

  // AC-3: file count < shard total
  it("AC-3: returns empty array when shard index exceeds file count (2 files, shard=3/3)", () => {
    const files = ["a.spec.ts", "b.spec.ts"];
    // ceil(2/3) = 1, shard 3 → [2..3) but only 2 files exist → empty
    expect(shardFiles(files, { index: 3, total: 3 })).toEqual([]);
  });

  it("AC-3: returns empty array when file list is empty and shard=1/1", () => {
    expect(shardFiles([], { index: 1, total: 1 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// shardFiles — invalid inputs throw errors
// ---------------------------------------------------------------------------

describe("shardFiles — invalid inputs", () => {
  it("throws on total = 0", () => {
    expect(() => shardFiles(["a.spec.ts"], { index: 1, total: 0 })).toThrow(
      "Invalid shard: 1/0"
    );
  });

  it("throws on index = 0", () => {
    expect(() => shardFiles(["a.spec.ts"], { index: 0, total: 3 })).toThrow(
      "Invalid shard: 0/3"
    );
  });

  it("throws when index > total", () => {
    expect(() => shardFiles(["a.spec.ts"], { index: 4, total: 3 })).toThrow(
      "Invalid shard: 4/3"
    );
  });

  it("throws on negative total", () => {
    expect(() => shardFiles(["a.spec.ts"], { index: 1, total: -1 })).toThrow(
      "Invalid shard: 1/-1"
    );
  });
});

// ---------------------------------------------------------------------------
// AC-4: shard in kaze.config.ts / kaze.config.js
// ---------------------------------------------------------------------------

describe("KazeConfig shard (AC-4)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kaze-shard-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads shard string from config file", async () => {
    writeTmpFile(tmpDir, "kaze.config.js", `export default { shard: "2/5" };`);
    const config = await loadConfig(tmpDir);
    expect(config.shard).toBe("2/5");
  });

  it("loads shard object from config file", async () => {
    writeTmpFile(tmpDir, "kaze.config.js", `export default { shard: { index: 2, total: 5 } };`);
    const config = await loadConfig(tmpDir);
    expect(config.shard).toEqual({ index: 2, total: 5 });
  });

  it("shard is undefined when not set", async () => {
    writeTmpFile(tmpDir, "kaze.config.js", `export default { workers: 2 };`);
    const config = await loadConfig(tmpDir);
    expect(config.shard).toBeUndefined();
  });

  it("exits with code 2 when shard is invalid type (number)", async () => {
    writeTmpFile(tmpDir, "kaze.config.js", `export default { shard: 3 };`);
    const mockExit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(loadConfig(tmpDir)).rejects.toThrow("process.exit(2)");
    mockExit.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// AC-4: mergeConfig shard
// ---------------------------------------------------------------------------

describe("mergeConfig shard (AC-4)", () => {
  it("CLI shard overrides config file shard", () => {
    const fileConfig: KazeConfig = { shard: "1/3" };
    const merged = mergeConfig(fileConfig, { shard: "2/3" });
    expect(merged.shard).toBe("2/3");
  });

  it("undefined CLI shard does not override config file value", () => {
    const fileConfig: KazeConfig = { shard: "1/3" };
    const merged = mergeConfig(fileConfig, { shard: undefined });
    expect(merged.shard).toBe("1/3");
  });
});

// ---------------------------------------------------------------------------
// AC-5: verbose reporter shows [Shard N/M] prefix
// ---------------------------------------------------------------------------

describe("report with shard info (AC-5)", () => {
  it("prints [Shard 1/3] prefix before results in verbose mode", () => {
    const results: TestResult[] = [makeResult("my test")];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      report(results, "verbose", { index: 1, total: 3 });
      expect(logSpy).toHaveBeenCalledWith("[Shard 1/3]");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints [Shard 2/5] prefix in verbose mode", () => {
    const results: TestResult[] = [makeResult("other test")];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      report(results, "verbose", { index: 2, total: 5 });
      expect(logSpy).toHaveBeenCalledWith("[Shard 2/5]");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("does NOT print shard prefix when shard is undefined", () => {
    const results: TestResult[] = [makeResult("my test")];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      report(results, "verbose");
      const calls = logSpy.mock.calls.map((c) => c[0] as string);
      expect(calls.some((c) => c.startsWith("[Shard"))).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("does NOT print shard prefix in dot mode even when shard is provided", () => {
    const results: TestResult[] = [makeResult("my test")];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      report(results, "dot", { index: 1, total: 3 });
      const calls = logSpy.mock.calls.map((c) => c[0] as string);
      expect(calls.some((c) => c.startsWith("[Shard"))).toBe(false);
    } finally {
      logSpy.mockRestore();
      writeSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-8: --shard and --watch are mutually exclusive
// ---------------------------------------------------------------------------

describe("AC-8: --shard and --watch mutual exclusion", () => {
  function runCLI(args: string[]): { status: number | null; stderr: string } {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx/esm", CLI_ENTRY, ...args],
      {
        encoding: "utf8",
        env: { ...process.env, KAZE_SKIP_E2E: "1" },
        timeout: 10000,
      }
    );
    return {
      status: result.status,
      stderr: result.stderr ?? "",
    };
  }

  it("exits with code 1 and prints error when --watch and --shard are combined", () => {
    const { status, stderr } = runCLI(["--watch", "--shard=1/3"]);
    expect(status).toBe(1);
    expect(stderr).toContain("[kaze] --shard cannot be used with --watch");
  });

  it("exits with code 1 regardless of shard order (--shard before --watch)", () => {
    const { status, stderr } = runCLI(["--shard=2/4", "--watch"]);
    expect(status).toBe(1);
    expect(stderr).toContain("[kaze] --shard cannot be used with --watch");
  });
});

// ---------------------------------------------------------------------------
// AC-9: out-of-range shard values detected at CLI level (exit 2)
// ---------------------------------------------------------------------------

describe("AC-9: CLI-level shard range validation", () => {
  function runCLI(args: string[]): { status: number | null; stderr: string } {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx/esm", CLI_ENTRY, ...args],
      {
        encoding: "utf8",
        env: { ...process.env, KAZE_SKIP_E2E: "1" },
        timeout: 10000,
      }
    );
    return {
      status: result.status,
      stderr: result.stderr ?? "",
    };
  }

  it("exits with code 2 and prints error for --shard=0/3 (index = 0)", () => {
    const { status, stderr } = runCLI(["--shard=0/3"]);
    expect(status).toBe(2);
    expect(stderr).toContain('[kaze] Invalid --shard value "0/3": index must be between 1 and total');
  });

  it("exits with code 2 and prints error for --shard=4/3 (index > total)", () => {
    const { status, stderr } = runCLI(["--shard=4/3"]);
    expect(status).toBe(2);
    expect(stderr).toContain('[kaze] Invalid --shard value "4/3": index must be between 1 and total');
  });

  it("exits with code 2 for --shard=1/0 (total = 0)", () => {
    const { status, stderr } = runCLI(["--shard=1/0"]);
    expect(status).toBe(2);
    expect(stderr).toContain('[kaze] Invalid --shard value "1/0": index must be between 1 and total');
  });
});
