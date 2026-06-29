import os from "os";
import { execSync } from "node:child_process";

/**
 * A snapshot of the host machine's memory and CPU resources.
 */
export interface HostResources {
  /** Total physical RAM in megabytes. */
  totalMemMB: number;
  /** Currently free (available) RAM in megabytes. */
  freeMemMB: number;
  /** Number of logical CPU cores. */
  cpuCount: number;
}

/**
 * On macOS, os.freemem() returns only truly free pages and ignores inactive/
 * purgeable memory that the OS will reclaim on demand. This drastically
 * underestimates available memory. Use vm_stat to get a realistic picture.
 */
function getMacOSAvailableMemMB(): number {
  try {
    const output = execSync("vm_stat", { encoding: "utf8", timeout: 1000 });
    const pageSize = parseInt(output.match(/page size of (\d+) bytes/)?.[1] ?? "4096");
    const parse = (key: string): number => {
      const m = output.match(new RegExp(`${key}:\\s+(\\d+)`));
      return m ? parseInt(m[1]!) : 0;
    };
    // free + inactive + speculative pages are all available to new allocations
    const availablePages = parse("Pages free") + parse("Pages inactive") + parse("Pages speculative");
    return Math.floor((availablePages * pageSize) / 1024 / 1024);
  } catch {
    // Fall back to a conservative 50% of total RAM if vm_stat fails
    return Math.floor(os.totalmem() / 2 / 1024 / 1024);
  }
}

/**
 * Probes the host machine and returns a resource snapshot.
 * This is the only function in the module that has a side effect (reading OS state).
 * All downstream calculations remain pure functions.
 *
 * GAP-2: cpuCount is guarded with Math.max(1, ...) to handle environments where
 * os.cpus() returns an empty array (e.g., certain containerized environments).
 */
export function probeHostResources(): HostResources {
  const freeMemMB =
    process.platform === "darwin"
      ? getMacOSAvailableMemMB()
      : Math.floor(os.freemem() / 1024 / 1024);

  return {
    totalMemMB: Math.floor(os.totalmem() / 1024 / 1024),
    freeMemMB,
    cpuCount: Math.max(1, os.cpus().length),
  };
}
