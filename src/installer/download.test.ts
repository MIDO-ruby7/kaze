import os from "node:os";
import path from "node:path";

import { describe, it, expect, vi, afterEach } from "vitest";

import {
  detectPlatform,
  resolveVersion,
  isInstalled,
  chromiumInstallDir,
  extractZip,
  downloadAndInstall,
  type KnownGoodVersionsResponse,
} from "./download.js";

// ---------------------------------------------------------------------------
// Helpers to build fixture data
// ---------------------------------------------------------------------------

function makeVersionData(
  versions: Array<{ version: string; platforms: string[] }>,
): KnownGoodVersionsResponse {
  return {
    timestamp: "2024-01-01T00:00:00.000Z",
    versions: versions.map(({ version, platforms }) => ({
      version,
      downloads: {
        chrome: platforms.map((platform) => ({
          platform,
          url: `https://example.com/chrome-${version}-${platform}.zip`,
        })),
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// AC-1 / resolveVersion
// ---------------------------------------------------------------------------

describe("resolveVersion", () => {
  const data = makeVersionData([
    { version: "120.0.6099.56", platforms: ["mac-arm64", "mac-x64", "linux64", "win64"] },
    { version: "121.0.6167.57", platforms: ["mac-arm64", "mac-x64", "linux64", "win64"] },
    { version: "122.0.6261.57", platforms: ["mac-arm64", "mac-x64", "linux64", "win64"] },
  ]);

  it("returns the latest version when no version is specified", async () => {
    const result = await resolveVersion(data, "mac-arm64");
    expect(result.version).toBe("122.0.6261.57");
    expect(result.downloadUrl).toContain("mac-arm64");
  });

  it("returns the requested version when it exists", async () => {
    const result = await resolveVersion(data, "linux64", "121.0.6167.57");
    expect(result.version).toBe("121.0.6167.57");
    expect(result.downloadUrl).toContain("linux64");
  });

  it("throws when a requested version does not exist", async () => {
    await expect(resolveVersion(data, "mac-arm64", "999.0.0.0")).rejects.toThrow("999.0.0.0");
  });

  it("throws when no versions are available for the platform", async () => {
    const noLinuxData = makeVersionData([{ version: "120.0.6099.56", platforms: ["mac-arm64"] }]);
    await expect(resolveVersion(noLinuxData, "linux64")).rejects.toThrow("linux64");
  });

  it("download URL corresponds to the requested platform", async () => {
    const result = await resolveVersion(data, "win64");
    expect(result.downloadUrl).toContain("win64");
  });
});

// ---------------------------------------------------------------------------
// AC-2 / detectPlatform
// ---------------------------------------------------------------------------

describe("detectPlatform", () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;

  afterEach(() => {
    // Reset after each test
    Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    Object.defineProperty(process, "arch", { value: originalArch, writable: true });
  });

  it("returns mac-arm64 on darwin/arm64", () => {
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    Object.defineProperty(process, "arch", { value: "arm64", writable: true });
    expect(detectPlatform()).toBe("mac-arm64");
  });

  it("returns mac-x64 on darwin/x64", () => {
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    Object.defineProperty(process, "arch", { value: "x64", writable: true });
    expect(detectPlatform()).toBe("mac-x64");
  });

  it("returns win64 on win32", () => {
    Object.defineProperty(process, "platform", { value: "win32", writable: true });
    expect(detectPlatform()).toBe("win64");
  });

  it("returns linux64 on linux", () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    expect(detectPlatform()).toBe("linux64");
  });

  it("returns linux64 for unknown platforms", () => {
    Object.defineProperty(process, "platform", { value: "freebsd", writable: true });
    expect(detectPlatform()).toBe("linux64");
  });
});

// ---------------------------------------------------------------------------
// AC-4 / isInstalled
// ---------------------------------------------------------------------------

describe("isInstalled", () => {
  it("returns false when the install dir does not exist", () => {
    // Use a version string that certainly won't exist on disk
    expect(isInstalled("0.0.0.0-nonexistent-test")).toBe(false);
  });

  it("returns true when the install dir exists", async () => {
    // Mock fs.existsSync to simulate an existing installation
    const fsMod = await import("node:fs");
    const fsMock = vi.spyOn(fsMod.default, "existsSync").mockReturnValueOnce(true);

    expect(isInstalled("122.0.6261.57")).toBe(true);
    fsMock.mockRestore();
  });

  it("chromiumInstallDir returns the correct path", () => {
    const expected = path.join(os.homedir(), ".kaze", "browsers", "chromium-122.0.6261.57");
    expect(chromiumInstallDir("122.0.6261.57")).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// extractZip (basic smoke test + path traversal guard)
// ---------------------------------------------------------------------------

describe("extractZip", () => {
  it("extracts stored files correctly", async () => {
    const { default: fs } = await import("node:fs");
    const { default: osMod } = await import("node:os");
    const { default: pathMod } = await import("node:path");

    // Build a minimal ZIP with one stored file: "hello.txt" containing "hi"
    const content = Buffer.from("hi");
    const fileName = Buffer.from("hello.txt");

    // Local file header
    const localHeader = Buffer.alloc(30 + fileName.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // compression: stored
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(0, 14); // crc-32 (we skip validation)
    localHeader.writeUInt32LE(content.length, 18); // compressed size
    localHeader.writeUInt32LE(content.length, 22); // uncompressed size
    localHeader.writeUInt16LE(fileName.length, 26); // file name length
    localHeader.writeUInt16LE(0, 28); // extra field length
    fileName.copy(localHeader, 30);

    // Central directory + end record (minimal, extractor only needs local headers)
    const centralDir = Buffer.alloc(46 + fileName.length);
    centralDir.writeUInt32LE(0x02014b50, 0); // central dir signature
    centralDir.writeUInt16LE(20, 4);
    centralDir.writeUInt16LE(20, 6);
    centralDir.writeUInt16LE(0, 8);
    centralDir.writeUInt16LE(0, 10);
    centralDir.writeUInt16LE(0, 12);
    centralDir.writeUInt16LE(0, 14);
    centralDir.writeUInt32LE(0, 16);
    centralDir.writeUInt32LE(content.length, 20);
    centralDir.writeUInt32LE(content.length, 24);
    centralDir.writeUInt16LE(fileName.length, 28);
    centralDir.writeUInt16LE(0, 30);
    centralDir.writeUInt16LE(0, 32);
    centralDir.writeUInt16LE(0, 34);
    centralDir.writeUInt16LE(0, 36);
    centralDir.writeUInt32LE(0, 38);
    centralDir.writeUInt32LE(0, 42);
    fileName.copy(centralDir, 46);

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(centralDir.length, 12);
    eocd.writeUInt32LE(localHeader.length + content.length, 16);
    eocd.writeUInt16LE(0, 20);

    const zip = Buffer.concat([localHeader, content, centralDir, eocd]);

    const tmpDir = fs.mkdtempSync(pathMod.join(osMod.tmpdir(), "kaze-test-"));
    try {
      extractZip(zip, tmpDir);
      const extracted = fs.readFileSync(pathMod.join(tmpDir, "hello.txt"), "utf-8");
      expect(extracted).toBe("hi");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws on path traversal attempt (B-2)", async () => {
    const { default: fs } = await import("node:fs");
    const { default: osMod } = await import("node:os");
    const { default: pathMod } = await import("node:path");

    // Build a ZIP with a traversal path: "../escape.txt"
    const content = Buffer.from("evil");
    const traversalName = "../escape.txt";
    const fileNameBuf = Buffer.from(traversalName);

    const localHeader = Buffer.alloc(30 + fileNameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8); // stored
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(fileNameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    fileNameBuf.copy(localHeader, 30);

    const zip = Buffer.concat([localHeader, content]);

    const tmpDir = fs.mkdtempSync(pathMod.join(osMod.tmpdir(), "kaze-traversal-"));
    try {
      expect(() => extractZip(zip, tmpDir)).toThrow("path traversal");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// downloadAndInstall (B-1: idempotency cleanup on failure)
// ---------------------------------------------------------------------------

describe("downloadAndInstall", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cleans up install directory when download fails (B-1)", async () => {
    const fsMod = await import("node:fs");
    const fsSpy = vi.spyOn(fsMod.default, "mkdirSync").mockImplementation(() => undefined);

    const rmSpy = vi.spyOn(fsMod.default, "rmSync").mockImplementation(() => undefined);

    // httpsGetRedirect is internal, so we mock https.get via node:https
    const httpsMod = await import("node:https");
    vi.spyOn(httpsMod.default, "get").mockImplementation((_url, cb) => {
      // Simulate a network error by calling the error handler
      const fakeReq = {
        on: (event: string, handler: (err: Error) => void) => {
          if (event === "error") {
            handler(new Error("network error"));
          }
          return fakeReq;
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void cb; // cb is the response handler, not called in error path
      return fakeReq as ReturnType<typeof httpsMod.default.get>;
    });

    await expect(
      downloadAndInstall("122.0.6261.57", "https://example.com/chrome.zip"),
    ).rejects.toThrow("network error");

    // rmSync must have been called to clean up the partial install directory
    expect(rmSpy).toHaveBeenCalledWith(
      expect.stringContaining("chromium-122.0.6261.57"),
      expect.objectContaining({ recursive: true, force: true }),
    );

    fsSpy.mockRestore();
    rmSpy.mockRestore();
  });

  it("does not call rmSync when download and install succeed", async () => {
    const fsMod = await import("node:fs");

    // Minimal valid ZIP buffer (just enough to not throw in extractZip)
    const emptyZip = Buffer.alloc(4);
    emptyZip.writeUInt32LE(0x06054b50, 0); // EOCD signature — triggers break immediately

    vi.spyOn(fsMod.default, "mkdirSync").mockImplementation(() => undefined);
    vi.spyOn(fsMod.default, "readdirSync").mockReturnValue([]);
    const rmSpy = vi.spyOn(fsMod.default, "rmSync").mockImplementation(() => undefined);

    const httpsMod = await import("node:https");
    vi.spyOn(httpsMod.default, "get").mockImplementation((_url, cb) => {
      const chunks: Buffer[] = [emptyZip];
      const fakeRes = {
        statusCode: 200,
        headers: {},
        on: (event: string, handler: (arg?: Buffer) => void) => {
          if (event === "data") chunks.forEach((c) => handler(c));
          if (event === "end") handler();
          return fakeRes;
        },
        resume: () => {},
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cb as any)(fakeRes);
      const fakeReq = {
        on: (_e: string, _h: unknown) => fakeReq,
      };
      return fakeReq as ReturnType<typeof httpsMod.default.get>;
    });

    await downloadAndInstall("122.0.6261.57", "https://example.com/chrome.zip");

    expect(rmSpy).not.toHaveBeenCalled();
  });
});
