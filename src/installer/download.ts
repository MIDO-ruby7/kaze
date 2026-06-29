import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VersionEntry {
  version: string;
  downloads: {
    chrome?: PlatformDownload[];
    chromedriver?: PlatformDownload[];
  };
}

export interface PlatformDownload {
  platform: string;
  url: string;
}

export interface KnownGoodVersionsResponse {
  timestamp: string;
  versions: VersionEntry[];
}

// ---------------------------------------------------------------------------
// Platform detection (AC-2)
// ---------------------------------------------------------------------------

export type SupportedPlatform = "mac-arm64" | "mac-x64" | "linux64" | "win64";

export function detectPlatform(): SupportedPlatform {
  const { platform, arch } = process;

  if (platform === "darwin") {
    return arch === "arm64" ? "mac-arm64" : "mac-x64";
  }
  if (platform === "win32") {
    return "win64";
  }
  // Default to linux64 for linux + other unix-likes
  return "linux64";
}

// ---------------------------------------------------------------------------
// Version list fetch (AC-1)
// ---------------------------------------------------------------------------

const CFT_JSON_URL =
  "https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json";

export function fetchVersionList(): Promise<KnownGoodVersionsResponse> {
  return new Promise((resolve, reject) => {
    https
      .get(CFT_JSON_URL, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch version list: HTTP ${res.statusCode ?? "unknown"}`));
          res.resume();
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const body = Buffer.concat(chunks).toString("utf-8");
            resolve(JSON.parse(body) as KnownGoodVersionsResponse);
          } catch (e) {
            reject(e);
          }
        });
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

/**
 * Return the latest stable version string from the known-good list.
 * If a specific version is requested, verify it exists first.
 */
export async function resolveVersion(
  data: KnownGoodVersionsResponse,
  platform: SupportedPlatform,
  requestedVersion?: string,
): Promise<{ version: string; downloadUrl: string }> {
  const candidates = data.versions
    .filter((v) => v.downloads.chrome?.some((d) => d.platform === platform))
    .reverse(); // latest first

  let entry: VersionEntry | undefined;

  if (requestedVersion) {
    entry = candidates.find((v) => v.version === requestedVersion);
    if (!entry) {
      throw new Error(`Requested version ${requestedVersion} not found for platform ${platform}`);
    }
  } else {
    entry = candidates[0];
    if (!entry) {
      throw new Error(`No versions available for platform ${platform}`);
    }
  }

  const dl = entry.downloads.chrome!.find((d) => d.platform === platform)!;
  return { version: entry.version, downloadUrl: dl.url };
}

// ---------------------------------------------------------------------------
// Install path helpers (AC-3, AC-4)
// ---------------------------------------------------------------------------

export function chromiumInstallDir(version: string): string {
  return path.join(os.homedir(), ".kaze", "browsers", `chromium-${version}`);
}

export function isInstalled(version: string): boolean {
  return fs.existsSync(chromiumInstallDir(version));
}

// ---------------------------------------------------------------------------
// Download + unzip (AC-3)
// ---------------------------------------------------------------------------

function httpsGetRedirect(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const get = (currentUrl: string, redirects = 0) => {
      if (redirects > 10) {
        reject(new Error("Too many redirects"));
        return;
      }
      https
        .get(currentUrl, (res) => {
          if (
            res.statusCode !== undefined &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            get(res.headers.location, redirects + 1);
            res.resume();
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode ?? "unknown"}`));
            res.resume();
            return;
          }
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks)));
          res.on("error", reject);
        })
        .on("error", reject);
    };
    get(url);
  });
}

/**
 * Minimal ZIP extractor using only Node.js built-ins.
 *
 * ZIP format reference:
 *   https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 *
 * Only handles DEFLATE (method 8) and stored (method 0) entries.
 */
export function extractZip(zipBuffer: Buffer, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });

  let offset = 0;

  while (offset < zipBuffer.length - 4) {
    const sig = zipBuffer.readUInt32LE(offset);

    // Local file header signature = 0x04034b50
    if (sig !== 0x04034b50) break;

    const compression = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const fileNameLen = zipBuffer.readUInt16LE(offset + 26);
    const extraLen = zipBuffer.readUInt16LE(offset + 28);

    const fileName = zipBuffer.subarray(offset + 30, offset + 30 + fileNameLen).toString("utf-8");

    const dataStart = offset + 30 + fileNameLen + extraLen;
    const compressedData = zipBuffer.subarray(dataStart, dataStart + compressedSize);

    offset = dataStart + compressedSize;

    if (fileName.endsWith("/")) {
      // Directory entry
      fs.mkdirSync(path.join(destDir, fileName), { recursive: true });
      continue;
    }

    const outPath = path.join(destDir, fileName);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    if (compression === 0) {
      // Stored
      fs.writeFileSync(outPath, compressedData);
    } else if (compression === 8) {
      // Deflate
      const inflated = zlib.inflateRawSync(compressedData);
      fs.writeFileSync(outPath, inflated);
    } else {
      throw new Error(`Unsupported compression method ${compression} in ${fileName}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public download+install function
// ---------------------------------------------------------------------------

export async function downloadAndInstall(version: string, downloadUrl: string): Promise<void> {
  const installDir = chromiumInstallDir(version);
  fs.mkdirSync(installDir, { recursive: true });

  const zipBuffer = await httpsGetRedirect(downloadUrl);
  extractZip(zipBuffer, installDir);

  // Make the chromium binary executable on unix
  if (process.platform !== "win32") {
    const bins = ["chrome", "chromium", "chrome-linux", "chrome-mac"];
    for (const bin of bins) {
      const binPath = findFile(installDir, bin);
      if (binPath) {
        fs.chmodSync(binPath, 0o755);
      }
    }
  }
}

/** Recursively find the first file matching `name` under `dir`. */
function findFile(dir: string, name: string): string | undefined {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return undefined;
}
