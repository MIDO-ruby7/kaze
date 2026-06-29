import type { HostResources } from "./resources.js";

/** Assumed RAM usage (MB) per Chromium browser process. */
const DEFAULT_RAM_PER_PROCESS_MB = 350;

/** Assumed RAM usage (MB) per browser context. */
const DEFAULT_RAM_PER_CONTEXT_MB = 50;

/**
 * Optimal contexts per browser process.
 * Benchmarks show throughput degrades above 10 concurrent CDP sessions per process.
 */
const CONTEXTS_PER_PROCESS = 10;

/** Result of a pool sizing calculation. */
export interface PoolSizing {
  /** Number of browser processes to spawn. */
  processCount: number;
  /** Number of browser contexts to open per process. */
  contextsPerProcess: number;
  /** Total parallel slots (processCount × contextsPerProcess). */
  totalParallel: number;
  /**
   * True when free RAM is below the minimum threshold required to run even one
   * browser process with one context (350 MB process + 50 MB context = 400 MB).
   */
  insufficientMemory: boolean;
}

/** User-provided overrides. */
export interface PoolSizingOpts {
  /** Hard upper limit on the number of browser processes. */
  maxProcesses?: number;
  /** Hard upper limit on contexts per process. */
  maxContextsPerProcess?: number;
  /**
   * Target total parallel slots.
   * Overrides processCount calculation: processCount = ceil(workers / contextsPerProcess).
   * Useful for CI: set KAZE_WORKERS=N or pass workers=N directly.
   */
  workers?: number;
}

/**
 * Pure function: derives the optimal pool sizing from a resource snapshot and
 * optional user overrides.
 *
 * kaze's core advantage over Playwright:
 *   Playwright needs 1 browser process per parallel worker (300 workers = 300 processes).
 *   kaze shares browser processes: 300 parallel = 30 processes × 10 contexts.
 *   RAM ratio: kaze uses ~4x less RAM for the same parallelism.
 *
 * Strategy:
 *   1. Fix contextsPerProcess = 10 (empirical sweet spot per browser process).
 *   2. Compute processCount from RAM budget (no artificial CPU-based cap).
 *   3. Apply user overrides (workers=N for CI, maxProcesses for fine-tuning).
 *   4. Respect KAZE_WORKERS env var for CI configuration.
 */
export function computePoolSizing(
  resources: HostResources,
  opts?: PoolSizingOpts,
): PoolSizing {
  const { freeMemMB } = resources;

  const MINIMUM_MEMORY_MB = DEFAULT_RAM_PER_PROCESS_MB + DEFAULT_RAM_PER_CONTEXT_MB;
  const insufficientMemory = freeMemMB < MINIMUM_MEMORY_MB;

  // Effective contextsPerProcess (allow override but default to empirical optimum)
  const ctxPerProc = Math.max(
    1,
    opts?.maxContextsPerProcess ?? CONTEXTS_PER_PROCESS,
  );

  // Effective target workers (env var > option > auto)
  const envWorkers = process.env.KAZE_WORKERS ? parseInt(process.env.KAZE_WORKERS, 10) : undefined;
  const targetWorkers = envWorkers ?? opts?.workers;

  let processCount: number;

  if (targetWorkers !== undefined && targetWorkers > 0) {
    // Explicit worker count: derive processCount from it
    processCount = Math.max(1, Math.ceil(targetWorkers / ctxPerProc));
  } else {
    // Auto: fill usable RAM with browser processes.
    // Reserve 1GB as OS/other-process buffer to avoid memory pressure.
    const RESERVED_MB = 1024;
    const usableMB = Math.max(0, freeMemMB - RESERVED_MB);
    const ramPerProcess = DEFAULT_RAM_PER_PROCESS_MB + ctxPerProc * DEFAULT_RAM_PER_CONTEXT_MB;
    processCount = Math.max(1, Math.floor(usableMB / ramPerProcess));
  }

  // Apply user cap
  if (opts?.maxProcesses !== undefined) {
    processCount = Math.min(processCount, opts.maxProcesses);
  }

  const finalContextsPerProcess = ctxPerProc;
  const finalProcessCount = Math.max(1, processCount);

  return {
    processCount: finalProcessCount,
    contextsPerProcess: finalContextsPerProcess,
    totalParallel: finalProcessCount * finalContextsPerProcess,
    insufficientMemory,
  };
}
