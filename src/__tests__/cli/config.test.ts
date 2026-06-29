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
// loadConfig
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kaze-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("AC-4: returns empty object when no config file exists", async () => {
    const config = await loadConfig(tmpDir);
    expect(config).toEqual({});
  });

  it("AC-1/AC-2: loads kaze.config.js with all supported fields", async () => {
    writeTmpFile(
      tmpDir,
      "kaze.config.js",
      `export default { workers: 10, timeout: 5000, reporter: "dot", testMatch: ["**/*.e2e.ts"], screenshot: false };`
    );
    const config = await loadConfig(tmpDir);
    expect(config).toEqual({
      workers: 10,
      timeout: 5000,
      reporter: "dot",
      testMatch: ["**/*.e2e.ts"],
      screenshot: false,
    });
  });

  it("AC-1: prefers kaze.config.ts over kaze.config.js when both exist", async () => {
    writeTmpFile(tmpDir, "kaze.config.js", `export default { workers: 1 };`);
    writeTmpFile(tmpDir, "kaze.config.ts", `export default { workers: 99 };`);
    // kaze.config.ts is loaded first per implementation
    const config = await loadConfig(tmpDir);
    expect(config.workers).toBe(99);
  });

  it("AC-5: supports module with default export from defineConfig shape", async () => {
    writeTmpFile(
      tmpDir,
      "kaze.config.js",
      `export default { workers: 20 };`
    );
    const config = await loadConfig(tmpDir);
    expect(config.workers).toBe(20);
  });

  it("handles partial config (only some fields set)", async () => {
    writeTmpFile(tmpDir, "kaze.config.js", `export default { workers: 4 };`);
    const config = await loadConfig(tmpDir);
    expect(config.workers).toBe(4);
    expect(config.timeout).toBeUndefined();
    expect(config.reporter).toBeUndefined();
  });

  it("AC-9: exits with code 2 when workers is a string", async () => {
    writeTmpFile(
      tmpDir,
      "kaze.config.js",
      `export default { workers: "abc" };`
    );
    const mockExit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(loadConfig(tmpDir)).rejects.toThrow("process.exit(2)");
    mockExit.mockRestore();
  });

  it("AC-9: exits with code 2 when workers is a non-integer number", async () => {
    writeTmpFile(
      tmpDir,
      "kaze.config.js",
      `export default { workers: 1.5 };`
    );
    const mockExit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(loadConfig(tmpDir)).rejects.toThrow("process.exit(2)");
    mockExit.mockRestore();
  });

  it("AC-9: exits with code 2 when workers is less than 1", async () => {
    writeTmpFile(
      tmpDir,
      "kaze.config.js",
      `export default { workers: 0 };`
    );
    const mockExit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(loadConfig(tmpDir)).rejects.toThrow("process.exit(2)");
    mockExit.mockRestore();
  });

  it("AC-9: exits with code 2 when timeout is not a positive integer", async () => {
    writeTmpFile(
      tmpDir,
      "kaze.config.js",
      `export default { timeout: "slow" };`
    );
    const mockExit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(loadConfig(tmpDir)).rejects.toThrow("process.exit(2)");
    mockExit.mockRestore();
  });

  it("AC-9: exits with code 2 when reporter is invalid", async () => {
    writeTmpFile(
      tmpDir,
      "kaze.config.js",
      `export default { reporter: "json" };`
    );
    const mockExit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(loadConfig(tmpDir)).rejects.toThrow("process.exit(2)");
    mockExit.mockRestore();
  });

  it("AC-9: exits with code 2 when screenshot is not a boolean", async () => {
    writeTmpFile(
      tmpDir,
      "kaze.config.js",
      `export default { screenshot: "yes" };`
    );
    const mockExit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(loadConfig(tmpDir)).rejects.toThrow("process.exit(2)");
    mockExit.mockRestore();
  });

  it("AC-9: exits with code 2 when testMatch is not an array", async () => {
    writeTmpFile(
      tmpDir,
      "kaze.config.js",
      `export default { testMatch: "**/*.spec.ts" };`
    );
    const mockExit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(loadConfig(tmpDir)).rejects.toThrow("process.exit(2)");
    mockExit.mockRestore();
  });

  it("AC-9: valid config passes validation without error", async () => {
    writeTmpFile(
      tmpDir,
      "kaze.config.js",
      `export default { workers: 4, timeout: 30000, reporter: "dot", screenshot: true, testMatch: ["**/*.spec.ts"] };`
    );
    const config = await loadConfig(tmpDir);
    expect(config.workers).toBe(4);
    expect(config.timeout).toBe(30000);
    expect(config.reporter).toBe("dot");
    expect(config.screenshot).toBe(true);
    expect(config.testMatch).toEqual(["**/*.spec.ts"]);
  });
});

// ---------------------------------------------------------------------------
// mergeConfig
// ---------------------------------------------------------------------------

describe("mergeConfig", () => {
  it("AC-3: CLI values override config file values", () => {
    const fileConfig: KazeConfig = {
      workers: 5,
      timeout: 10000,
      reporter: "dot",
      testMatch: ["**/*.e2e.ts"],
      screenshot: false,
    };
    const cliOverrides: KazeConfig = {
      workers: 20,
      timeout: 30000,
    };
    const merged = mergeConfig(fileConfig, cliOverrides);
    expect(merged.workers).toBe(20);
    expect(merged.timeout).toBe(30000);
    // config file values preserved when not overridden
    expect(merged.reporter).toBe("dot");
    expect(merged.testMatch).toEqual(["**/*.e2e.ts"]);
    expect(merged.screenshot).toBe(false);
  });

  it("AC-3: CLI undefined values do not override config file values", () => {
    const fileConfig: KazeConfig = { workers: 5 };
    const cliOverrides: KazeConfig = { workers: undefined };
    const merged = mergeConfig(fileConfig, cliOverrides);
    expect(merged.workers).toBe(5);
  });

  it("AC-4: works with empty file config (no config file)", () => {
    const fileConfig: KazeConfig = {};
    const cliOverrides: KazeConfig = { workers: 10 };
    const merged = mergeConfig(fileConfig, cliOverrides);
    expect(merged.workers).toBe(10);
  });

  it("returns empty config when both are empty", () => {
    const merged = mergeConfig({}, {});
    expect(merged).toEqual({});
  });

  it("AC-8: --screenshot=on overrides config file screenshot: false", () => {
    const fileConfig: KazeConfig = { screenshot: false };
    // CLI passes true (from --screenshot=on)
    const merged = mergeConfig(fileConfig, { screenshot: true });
    expect(merged.screenshot).toBe(true);
  });

  it("AC-8: --screenshot=off overrides config file screenshot: true", () => {
    const fileConfig: KazeConfig = { screenshot: true };
    const merged = mergeConfig(fileConfig, { screenshot: false });
    expect(merged.screenshot).toBe(false);
  });

  it("AC-8: absent --screenshot does not override config file value", () => {
    const fileConfig: KazeConfig = { screenshot: false };
    // CLI passes undefined (flag not specified)
    const merged = mergeConfig(fileConfig, { screenshot: undefined });
    expect(merged.screenshot).toBe(false);
  });
});
