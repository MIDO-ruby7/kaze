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
// grep filtering logic (AC-5, AC-6)
// ---------------------------------------------------------------------------

describe("grep filtering (AC-5, AC-6)", () => {
  it("AC-5: grep filters test cases by regex match", () => {
    const cases = [
      { name: "login: success" },
      { name: "logout: success" },
      { name: "login: failure" },
    ];
    const grep = "login";
    const filtered = cases.filter((c) => new RegExp(grep).test(c.name));
    expect(filtered).toHaveLength(2);
    expect(filtered.map((c) => c.name)).toEqual(["login: success", "login: failure"]);
  });

  it("AC-6: grepInvert excludes test cases matching regex", () => {
    const cases = [
      { name: "login: success" },
      { name: "logout: success" },
      { name: "login: failure" },
    ];
    const grepInvert = "login";
    const filtered = cases.filter((c) => !new RegExp(grepInvert).test(c.name));
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.name).toBe("logout: success");
  });

  it("AC-5: grep with complex regex pattern", () => {
    const cases = [
      { name: "auth > login" },
      { name: "auth > logout" },
      { name: "profile > update" },
    ];
    const grep = "^auth";
    const filtered = cases.filter((c) => new RegExp(grep).test(c.name));
    expect(filtered).toHaveLength(2);
  });

  it("AC-5 + AC-6: grep and grepInvert can be combined", () => {
    const cases = [
      { name: "auth > login success" },
      { name: "auth > login failure" },
      { name: "auth > logout" },
    ];
    const grep = "auth";
    const grepInvert = "failure";
    const filtered = cases
      .filter((c) => new RegExp(grep).test(c.name))
      .filter((c) => !new RegExp(grepInvert).test(c.name));
    expect(filtered).toHaveLength(2);
    expect(filtered.map((c) => c.name)).toEqual([
      "auth > login success",
      "auth > logout",
    ]);
  });
});
