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
  /**
   * True when free RAM is below the minimum threshold required to run even one
   * browser process with one context (350 MB process + 50 MB context = 400 MB).
   * Callers can use this flag to warn users or refuse to start the pool.
   */
  insufficientMemory: boolean;
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
 *   1. Determine processCount from CPU cores (not RAM) — processes are I/O bound,
 *      not CPU bound. Cap at 4 to avoid diminishing returns.
 *   2. Fill the remaining RAM budget with as many contexts as possible across
 *      all processes. This maximises total parallelism.
 *   3. Clamp everything to at least 1 (AC-5 minimum guarantee).
 *   4. Apply user-provided overrides as additional upper bounds.
 */
export function computePoolSizing(
  resources: HostResources,
  opts?: PoolSizingOpts,
): PoolSizing {
  const { freeMemMB, cpuCount } = resources;

  // GAP-1: Detect insufficient memory (< 400 MB = 350 process + 50 context).
  const MINIMUM_MEMORY_MB = DEFAULT_RAM_PER_PROCESS_MB + DEFAULT_RAM_PER_CONTEXT_MB;
  const insufficientMemory = freeMemMB < MINIMUM_MEMORY_MB;

  // Step 1: processCount — driven by CPU, capped at 2.
  //   Multiple browser processes increase parallelism but also OS overhead.
  //   2 is the sweet spot for most developer machines.
  const processCount = Math.max(1, Math.min(Math.floor(cpuCount / 4), 2));

  // Step 2: Total context budget from remaining RAM.
  //   RAM used by processes: processCount × DEFAULT_RAM_PER_PROCESS_MB
  //   Remaining RAM is shared equally across all contexts.
  //   Cap at 10 contexts per process to avoid overwhelming a single browser.
  const MAX_CONTEXTS_PER_PROCESS = 10;
  const ramForProcesses = processCount * DEFAULT_RAM_PER_PROCESS_MB;
  const ramForContexts = Math.max(0, freeMemMB - ramForProcesses);
  const totalContexts = Math.max(1, Math.floor(ramForContexts / DEFAULT_RAM_PER_CONTEXT_MB));
  const contextsPerProcess = Math.max(
    1,
    Math.min(MAX_CONTEXTS_PER_PROCESS, Math.ceil(totalContexts / processCount)),
  );

  // Step 3: Apply user overrides as upper bounds.
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
    insufficientMemory,
  };
}
