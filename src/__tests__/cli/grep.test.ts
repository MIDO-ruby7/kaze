/**
 * Unit tests for --grep / --grepInvert CLI options and config fields.
 * AC-5, AC-6, AC-7 of Issue #25
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { loadConfig, mergeConfig } from "../../cli/config.js";
import type { KazeConfig } from "../../cli/config.js";
import { test as kazeTest, collectTestCases, _resetRegistry } from "../../api/test.js";
import type { ProtocolAdapter } from "../../protocol/index.js";

// ---------------------------------------------------------------------------
// Minimal stub AdapterResolver for collectTestCases
// ---------------------------------------------------------------------------

const stubPool = {
  getAdapter(_id: string): ProtocolAdapter {
    return {} as ProtocolAdapter;
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeTmpFile(dir: string, filename: string, content: string): string {
  const p = path.join(dir, filename);
  fs.writeFileSync(p, content, "utf8");
  return p;
}

// ---------------------------------------------------------------------------
// config: grep / grepInvert fields (AC-7)
// ---------------------------------------------------------------------------

describe("KazeConfig grep / grepInvert (AC-7)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kaze-grep-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads grep from config file", async () => {
    writeTmpFile(
      tmpDir,
      "kaze.config.js",
      `export default { grep: "login" };`
    );
    const config = await loadConfig(tmpDir);
    expect(config.grep).toBe("login");
  });

  it("loads grepInvert from config file", async () => {
    writeTmpFile(
      tmpDir,
      "kaze.config.js",
      `export default { grepInvert: "slow" };`
    );
    const config = await loadConfig(tmpDir);
    expect(config.grepInvert).toBe("slow");
  });

  it("loads both grep and grepInvert from config file", async () => {
    writeTmpFile(
      tmpDir,
      "kaze.config.js",
      `export default { grep: "auth", grepInvert: "legacy" };`
    );
    const config = await loadConfig(tmpDir);
    expect(config.grep).toBe("auth");
    expect(config.grepInvert).toBe("legacy");
  });

  it("grep and grepInvert are undefined when not set", async () => {
    writeTmpFile(tmpDir, "kaze.config.js", `export default { workers: 2 };`);
    const config = await loadConfig(tmpDir);
    expect(config.grep).toBeUndefined();
    expect(config.grepInvert).toBeUndefined();
  });

  it("exits with code 2 when grep is not a string", async () => {
    writeTmpFile(
      tmpDir,
      "kaze.config.js",
      `export default { grep: 123 };`
    );
    const mockExit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(loadConfig(tmpDir)).rejects.toThrow("process.exit(2)");
    mockExit.mockRestore();
  });

  it("exits with code 2 when grepInvert is not a string", async () => {
    writeTmpFile(
      tmpDir,
      "kaze.config.js",
      `export default { grepInvert: true };`
    );
    const mockExit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(loadConfig(tmpDir)).rejects.toThrow("process.exit(2)");
    mockExit.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// mergeConfig: grep / grepInvert (AC-7)
// ---------------------------------------------------------------------------

describe("mergeConfig grep / grepInvert (AC-7)", () => {
  it("CLI grep overrides config file grep", () => {
    const fileConfig: KazeConfig = { grep: "old-pattern" };
    const merged = mergeConfig(fileConfig, { grep: "new-pattern" });
    expect(merged.grep).toBe("new-pattern");
  });

  it("CLI grepInvert overrides config file grepInvert", () => {
    const fileConfig: KazeConfig = { grepInvert: "old" };
    const merged = mergeConfig(fileConfig, { grepInvert: "new" });
    expect(merged.grepInvert).toBe("new");
  });

  it("undefined CLI grep does not override config file value", () => {
    const fileConfig: KazeConfig = { grep: "keep" };
    const merged = mergeConfig(fileConfig, { grep: undefined });
    expect(merged.grep).toBe("keep");
  });

  it("undefined CLI grepInvert does not override config file value", () => {
    const fileConfig: KazeConfig = { grepInvert: "keep" };
    const merged = mergeConfig(fileConfig, { grepInvert: undefined });
    expect(merged.grepInvert).toBe("keep");
  });
});

// ---------------------------------------------------------------------------
// grep filtering via collectTestCases (AC-5, AC-6)
// ---------------------------------------------------------------------------

describe("grep filtering (AC-5, AC-6)", () => {
  beforeEach(() => {
    _resetRegistry();
  });

  it("AC-5: grep filters test cases by regex match", () => {
    // Register three tests using the real kaze test API
    kazeTest("login: success", async () => {});
    kazeTest("logout: success", async () => {});
    kazeTest("login: failure", async () => {});

    // collectTestCases with grep option — exercises the actual implementation
    const cases = collectTestCases(stubPool, { grep: "login" });
    expect(cases).toHaveLength(2);
    expect(cases.map((c) => c.name)).toEqual(["login: success", "login: failure"]);
  });

  it("AC-6: grepInvert excludes test cases matching regex", () => {
    kazeTest("login: success", async () => {});
    kazeTest("logout: success", async () => {});
    kazeTest("login: failure", async () => {});

    const cases = collectTestCases(stubPool, { grepInvert: "login" });
    expect(cases).toHaveLength(1);
    expect(cases[0]!.name).toBe("logout: success");
  });

  it("AC-5: grep with complex regex pattern", () => {
    kazeTest.describe("auth", () => {
      kazeTest("login", async () => {});
      kazeTest("logout", async () => {});
    });
    kazeTest.describe("profile", () => {
      kazeTest("update", async () => {});
    });

    // "^auth" matches names that start with "auth >" — test names are "auth > login", etc.
    const cases = collectTestCases(stubPool, { grep: "^auth" });
    expect(cases).toHaveLength(2);
    expect(cases.map((c) => c.name)).toEqual(["auth > login", "auth > logout"]);
  });

  it("AC-5 + AC-6: grep and grepInvert can be combined", () => {
    kazeTest.describe("auth", () => {
      kazeTest("login success", async () => {});
      kazeTest("login failure", async () => {});
      kazeTest("logout", async () => {});
    });

    const cases = collectTestCases(stubPool, { grep: "auth", grepInvert: "failure" });
    expect(cases).toHaveLength(2);
    expect(cases.map((c) => c.name)).toEqual([
      "auth > login success",
      "auth > logout",
    ]);
  });
});
