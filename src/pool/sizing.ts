import type { HostResources } from "./resources.js";

/** Assumed RAM usage (MB) per Chromium browser process. */
const DEFAULT_RAM_PER_PROCESS_MB = 350;

/** Assumed RAM usage (MB) per browser context. */
const DEFAULT_RAM_PER_CONTEXT_MB = 50;

/** Result of a pool sizing calculation. */
export interface PoolSizing {
  /** Number of browser processes to spawn. */
  processCount: number;
  /** Number of browser contexts to open per process. */
  contextsPerProcess: number;
}

/** User-provided overrides that cap the computed values. */
export interface PoolSizingOpts {
  /** Hard upper limit on the number of browser processes. */
  maxProcesses?: number;
  /** Hard upper limit on contexts per process. */
  maxContextsPerProcess?: number;
}

/**
 * Pure function: derives the optimal pool sizing from a resource snapshot and
 * optional user overrides.
 *
 * Strategy:
 *   1. Use `freeMemMB` as the available budget (conservative: only free RAM).
 *   2. Determine maximum processCount that fits in memory, capped by cpuCount.
 *   3. Distribute remaining memory across contexts per process.
 *   4. Clamp everything to at least 1 (AC-5 minimum guarantee).
 *   5. Apply user-provided overrides as additional upper bounds.
 */
export function computePoolSizing(
  resources: HostResources,
  opts?: PoolSizingOpts,
): PoolSizing {
  const { freeMemMB, cpuCount } = resources;

  // Step 1: How many processes can we fit in free RAM?
  //   Each process needs at least DEFAULT_RAM_PER_PROCESS_MB (+ 1 context).
  const ramPerProcessWithOneContext =
    DEFAULT_RAM_PER_PROCESS_MB + DEFAULT_RAM_PER_CONTEXT_MB;
  const processesByRam = Math.floor(freeMemMB / ramPerProcessWithOneContext);

  // Step 2: Cap by CPU core count.
  const uncappedProcessCount = Math.min(processesByRam, cpuCount);

  // Step 3: Enforce minimum of 1.
  const processCount = Math.max(1, uncappedProcessCount);

  // Step 4: With processCount fixed, compute how many contexts fit per process.
  //   remainingMemPerProcess = (freeMemMB / processCount) - DEFAULT_RAM_PER_PROCESS_MB
  const remainingMemPerProcess = freeMemMB / processCount - DEFAULT_RAM_PER_PROCESS_MB;
  const contextsByRam = Math.floor(
    remainingMemPerProcess / DEFAULT_RAM_PER_CONTEXT_MB,
  );
  const contextsPerProcess = Math.max(1, contextsByRam);

  // Step 5: Apply user overrides as upper bounds.
  const finalProcessCount =
    opts?.maxProcesses !== undefined
      ? Math.min(processCount, opts.maxProcesses)
      : processCount;

  const finalContextsPerProcess =
    opts?.maxContextsPerProcess !== undefined
      ? Math.min(contextsPerProcess, opts.maxContextsPerProcess)
      : contextsPerProcess;

  // Re-enforce minimum after overrides (AC-5).
  return {
    processCount: Math.max(1, finalProcessCount),
    contextsPerProcess: Math.max(1, finalContextsPerProcess),
  };
}
