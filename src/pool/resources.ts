import os from "os";

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
 * Probes the host machine and returns a resource snapshot.
 * This is the only function in the module that has a side effect (reading OS state).
 * All downstream calculations remain pure functions.
 */
export function probeHostResources(): HostResources {
  return {
    totalMemMB: Math.floor(os.totalmem() / 1024 / 1024),
    freeMemMB: Math.floor(os.freemem() / 1024 / 1024),
    cpuCount: os.cpus().length,
  };
}
