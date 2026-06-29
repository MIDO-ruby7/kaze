import {
  detectPlatform,
  fetchVersionList,
  resolveVersion,
  isInstalled,
  downloadAndInstall,
  chromiumInstallDir,
} from "./download.js";

export type { SupportedPlatform, VersionEntry, PlatformDownload } from "./download.js";

export interface InstallOptions {
  /** Specific Chrome for Testing version. Defaults to the latest known-good. */
  version?: string;
}

export interface InstallResult {
  version: string;
  installDir: string;
  /** true if the browser was newly downloaded, false if it was already present. */
  downloaded: boolean;
}

/**
 * Install a Chromium browser from Chrome for Testing.
 *
 * - Skips download if the requested (or latest) version is already present (AC-4).
 * - Uses only Node.js built-in modules (AC-3).
 */
export async function installBrowser(opts?: InstallOptions): Promise<InstallResult> {
  const platform = detectPlatform();
  const data = await fetchVersionList();
  const { version, downloadUrl } = await resolveVersion(data, platform, opts?.version);

  const installDir = chromiumInstallDir(version);

  if (isInstalled(version)) {
    return { version, installDir, downloaded: false };
  }

  await downloadAndInstall(version, downloadUrl);
  return { version, installDir, downloaded: true };
}
