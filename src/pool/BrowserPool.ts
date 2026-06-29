/**
 * BrowserPool — manages multiple Chromium processes and their BrowserContexts.
 *
 * AC-1: init() launches N processes, each with M contexts using probeHostResources + computePoolSizing.
 * AC-2: acquire() / release() with FIFO waiting queue.
 * AC-3: close() cleanly terminates all contexts and processes.
 * AC-4: Process crash → contexts marked failed, process auto-restarted (max 3 times).
 * AC-5: stats() returns { totalContexts, busy, idle, processes, crashes }.
 */

import { createAdapter } from "../protocol/index.js";
import type { ProtocolAdapter } from "../protocol/index.js";

import { probeHostResources } from "./resources.js";
import { computePoolSizing } from "./sizing.js";
import type { PooledContext, PoolStats } from "./types.js";

export type { PooledContext, PoolStats };

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** State of a single context slot managed by the pool. */
type ContextState = "idle" | "busy" | "failed" | "replacing";

interface ManagedContext {
  contextId: string;
  adapterId: string;
  state: ContextState;
}

/** A single managed browser process and its contexts. */
interface ManagedProcess {
  adapterId: string;
  adapter: ProtocolAdapter;
  contexts: ManagedContext[];
  /** How many times this specific process slot has been restarted after a crash. */
  crashCount: number;
  /** True while we are in the middle of restarting the process. */
  restarting: boolean;
  /** Port used by this adapter's CDP listener (to avoid collisions). */
  port: number;
}

/** Options for BrowserPool.init() */
export interface BrowserPoolInitOptions {
  maxProcesses?: number;
  maxContextsPerProcess?: number;
  /**
   * Target total parallel slots.
   * kaze derives processCount = ceil(workers / 10).
   * Can also be set via KAZE_WORKERS environment variable.
   * Example: workers=300 → 30 processes × 10 contexts = 300 parallel.
   */
  workers?: number;
  /** Base CDP port. Each process uses (basePort + index). Defaults to 9300. */
  basePort?: number;
  /** Executable path override (useful for tests). */
  executablePath?: string;
}

/** A waiter entry in the wait queue. */
interface WaitQueueEntry {
  resolve: (ctx: PooledContext) => void;
  reject: (err: Error) => void;
}

const MAX_CRASH_RESTARTS = 3;

// ---------------------------------------------------------------------------
// BrowserPool
// ---------------------------------------------------------------------------

export class BrowserPool {
  private processes: ManagedProcess[] = [];
  private waitQueue: WaitQueueEntry[] = [];
  private closed = false;
  private totalCrashes = 0;
  private nextAdapterSeq = 0;
  private initOpts: BrowserPoolInitOptions = {};
  private _exitHandler: (() => void) | null = null;

  // -------------------------------------------------------------------------
  // AC-1: init
  // -------------------------------------------------------------------------

  async init(opts?: BrowserPoolInitOptions): Promise<void> {
    if (this.closed) throw new Error("BrowserPool has been closed");
    this.initOpts = opts ?? {};

    const resources = probeHostResources();
    const sizing = computePoolSizing(resources, {
      maxProcesses: opts?.maxProcesses,
      maxContextsPerProcess: opts?.maxContextsPerProcess,
      workers: opts?.workers,
    });

    const basePort = opts?.basePort ?? 9300;

    await Promise.all(
      Array.from({ length: sizing.processCount }, (_, i) =>
        this._spawnProcess(basePort + i, sizing.contextsPerProcess),
      ),
    );

    // Ensure browsers are killed if the Node.js process exits unexpectedly
    // (e.g. Ctrl+C, uncaught exception) so no orphaned Chromium processes remain.
    this._exitHandler = () => { void this.close(); };
    process.once("exit", this._exitHandler);
    process.once("SIGINT", this._exitHandler);
    process.once("SIGTERM", this._exitHandler);
  }

  // -------------------------------------------------------------------------
  // AC-2: acquire / release
  // -------------------------------------------------------------------------

  acquire(): Promise<PooledContext> {
    if (this.closed) return Promise.reject(new Error("BrowserPool is closed"));

    const ctx = this._findIdleContext();
    if (ctx) {
      ctx.state = "busy";
      return Promise.resolve({ contextId: ctx.contextId, adapterId: ctx.adapterId });
    }

    // No idle context available — queue the caller (FIFO)
    return new Promise<PooledContext>((resolve, reject) => {
      this.waitQueue.push({ resolve, reject });
    });
  }

  release(pooled: PooledContext): void {
    // Try exact match first (normal path).
    let managed = this._findManagedContext(pooled.contextId, pooled.adapterId);

    // GAP-2 / B-3: If the process crashed, its adapterId was reassigned. Fall
    // back to a contextId-only search so the release is not silently swallowed.
    if (!managed) {
      managed = this._findManagedContextById(pooled.contextId);
    }

    if (!managed) {
      // Context is gone entirely (e.g. exceeded restart limit). Still drain the
      // queue so waiters get a chance with other idle contexts.
      this._drainQueue();
      return;
    }

    // Approach B: discard the used context and create a fresh one.
    // This guarantees complete state isolation (cookies, IndexedDB, Service
    // Workers) at the cost of one newContext() call per test.
    managed.state = "replacing";
    void this._replaceContext(managed, pooled._onReset);
  }

  /**
   * Close the used context and open a brand-new one in its slot.
   * Fires and forgets from release() so callers are not blocked.
   *
   * @param onReset - Optional callback from the Page that held this context.
   *   Called before adapter.resetContext() so Page-level route state is cleared
   *   in sync with the adapter-level reset (AC-14).
   */
  private async _replaceContext(
    managed: ManagedContext,
    onReset?: () => Promise<void>,
  ): Promise<void> {
    if (this.closed) return;

    const proc = this.processes.find((p) => p.adapterId === managed.adapterId);
    if (!proc) {
      this._drainQueue();
      return;
    }

    if (this.closed) return;

    try {
      if (proc.adapter.resetContext) {
        // AC-14: Clear Page-level state (routes, subscriptions) before the
        // adapter resets CDP state, keeping both layers in sync.
        if (onReset) await onReset().catch(() => {});
        // Approach C: reset in-place (~20ms) — reuses the page process,
        // clears all state via CDP (cookies incl. HttpOnly, storage, SW).
        // Identical isolation to close+create but ~35x faster.
        await proc.adapter.resetContext(managed.contextId);
        // contextId stays the same — the slot is ready immediately
      } else {
        // Fallback: close and create (original Approach B, ~700ms)
        try {
          await proc.adapter.closeContext(managed.contextId);
        } catch { /* ignore */ }
        if (this.closed) return;
        const newContextId = await proc.adapter.newContext();
        managed.contextId = newContextId;
        managed.adapterId = proc.adapterId;
      }

      const waiter = this.waitQueue.shift();
      if (waiter) {
        managed.state = "busy";
        waiter.resolve({ contextId: managed.contextId, adapterId: managed.adapterId });
      } else {
        managed.state = "idle";
      }
    } catch {
      managed.state = "failed";
      this._drainQueue();
    }
  }

  // -------------------------------------------------------------------------
  // AC-3: close
  // -------------------------------------------------------------------------

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Remove exit handlers registered in init()
    if (this._exitHandler) {
      process.off("exit", this._exitHandler);
      process.off("SIGINT", this._exitHandler);
      process.off("SIGTERM", this._exitHandler);
      this._exitHandler = null;
    }

    // B-1: Reject all queued waiters so their promises settle immediately.
    const err = new Error("BrowserPool closed while waiting for a context");
    for (const waiter of this.waitQueue) {
      waiter.reject(err);
    }
    this.waitQueue = [];

    // Close all processes (sends SIGTERM → SIGKILL to the process group)
    await Promise.all(this.processes.map((p) => this._closeProcess(p)));
    this.processes = [];
  }

  // -------------------------------------------------------------------------
  // AC-5: stats
  // -------------------------------------------------------------------------

  stats(): PoolStats {
    let busy = 0;
    let idle = 0;
    let totalContexts = 0;

    for (const proc of this.processes) {
      for (const ctx of proc.contexts) {
        totalContexts++;
        if (ctx.state === "busy" || ctx.state === "replacing") busy++;
        else if (ctx.state === "idle") idle++;
        // "failed" contexts are not counted as idle/busy
      }
    }

    return {
      totalContexts,
      busy,
      idle,
      processes: this.processes.length,
      crashes: this.totalCrashes,
    };
  }

  /** Return the ProtocolAdapter that owns the given adapterId. */
  getAdapter(adapterId: string): ProtocolAdapter {
    const proc = this.processes.find((p) => p.adapterId === adapterId);
    if (!proc) throw new Error(`No process found for adapterId: ${adapterId}`);
    return proc.adapter;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _findIdleContext(): ManagedContext | undefined {
    for (const proc of this.processes) {
      if (proc.restarting) continue;
      for (const ctx of proc.contexts) {
        if (ctx.state === "idle") return ctx;
      }
    }
    return undefined;
  }

  private _findManagedContext(
    contextId: string,
    adapterId: string,
  ): ManagedContext | undefined {
    const proc = this.processes.find((p) => p.adapterId === adapterId);
    return proc?.contexts.find((c) => c.contextId === contextId);
  }

  /**
   * GAP-2: Find a context by contextId alone, ignoring adapterId.
   * Used after a crash when the adapterId has been reassigned but the caller
   * still holds the old PooledContext token.
   */
  private _findManagedContextById(contextId: string): ManagedContext | undefined {
    for (const proc of this.processes) {
      const ctx = proc.contexts.find((c) => c.contextId === contextId);
      if (ctx) return ctx;
    }
    return undefined;
  }

  private async _spawnProcess(port: number, contextsPerProcess: number): Promise<void> {
    const adapterId = `adapter-${this.nextAdapterSeq++}`;
    const adapter = createAdapter({
      protocol: "cdp",
      cdp: { port, executablePath: this.initOpts.executablePath },
    });

    await adapter.launch();

    const proc: ManagedProcess = {
      adapterId,
      adapter,
      contexts: [],
      crashCount: 0,
      restarting: false,
      port,
    };
    this.processes.push(proc);

    // Pre-create the configured number of contexts
    await Promise.all(
      Array.from({ length: contextsPerProcess }, () => this._addContext(proc)),
    );

    // Watch for unexpected process exit (AC-4)
    this._watchProcess(proc);
  }

  private async _addContext(proc: ManagedProcess): Promise<void> {
    const contextId = await proc.adapter.newContext();
    proc.contexts.push({
      contextId,
      adapterId: proc.adapterId,
      state: "idle",
    });
  }

  private _watchProcess(proc: ManagedProcess): void {
    // CdpAdapter exposes the underlying process via the ProtocolAdapter.close()
    // but not a crash event directly. We detect crash by polling the process
    // object. Since CdpAdapter stores `process` privately, we rely on the
    // approach of wrapping newContext() failures to infer a crash, OR we use
    // the internal process reference if accessible.
    //
    // We implement crash detection by registering a sentinel context-operation
    // that will reject if the process dies — specifically, we monkey-patch
    // the adapter to detect when its operations start failing because the
    // underlying process is gone.
    //
    // Practical approach: use a keepalive probe every 500 ms. If the probe
    // fails, treat the process as crashed.
    const PROBE_INTERVAL_MS = 500;

    const probe = async (): Promise<void> => {
      if (this.closed || proc.restarting) return;

      // Use the first idle context for probing if available.
      const ctx = proc.contexts.find((c) => c.state === "idle");
      if (!ctx) {
        // GAP-3: No idle context to probe. Try a lightweight ping via newContext
        // to detect if the process is still alive. We immediately close the
        // test context to avoid leaking it.
        try {
          const testCtxId = await proc.adapter.newContext();
          await proc.adapter.closeContext(testCtxId);
        } catch {
          // Process is unresponsive — treat as crash
          if (!this.closed && !proc.restarting) {
            void this._handleCrash(proc);
          }
          return;
        }
        if (!this.closed && !proc.restarting) {
          setTimeout(() => void probe(), PROBE_INTERVAL_MS);
        }
        return;
      }

      // B-2: Mark the context busy before evaluating to prevent concurrent use.
      ctx.state = "busy";
      try {
        await proc.adapter.evaluate(ctx.contextId, "1");
        ctx.state = "idle";
        // Wake up any waiters that queued while this context was being probed.
        this._drainQueue();
        if (!this.closed && !proc.restarting) {
          setTimeout(() => void probe(), PROBE_INTERVAL_MS);
        }
      } catch {
        // Probe failed — restore state then treat as crash
        ctx.state = "idle";
        if (!this.closed && !proc.restarting) {
          void this._handleCrash(proc);
        }
      }
    };

    setTimeout(() => void probe(), PROBE_INTERVAL_MS);
  }

  /** AC-4: Handle a crashed process — mark contexts failed, restart if under limit. */
  private async _handleCrash(proc: ManagedProcess): Promise<void> {
    if (proc.restarting || this.closed) return;
    proc.restarting = true;
    this.totalCrashes++;

    // Mark all contexts of this process as failed
    for (const ctx of proc.contexts) {
      ctx.state = "failed";
    }

    // Try to close the adapter cleanly (best-effort)
    try {
      await proc.adapter.close();
    } catch {
      // ignore
    }

    if (proc.crashCount >= MAX_CRASH_RESTARTS) {
      // Exceeded restart limit — remove from active process list
      this.processes = this.processes.filter((p) => p !== proc);
      // Notify any waiters that might be stuck (they will be re-served if other
      // processes have idle contexts, otherwise they remain queued)
      this._drainQueue();
      return;
    }

    proc.crashCount++;

    // Restart the process
    try {
      const newAdapter = createAdapter({
        protocol: "cdp",
        cdp: { port: proc.port, executablePath: this.initOpts.executablePath },
      });
      await newAdapter.launch();

      proc.adapter = newAdapter;
      proc.adapterId = `adapter-${this.nextAdapterSeq++}`;
      proc.contexts = [];
      proc.restarting = false;

      // Recreate contexts using the current sizing config (AC-1: sizing.contextsPerProcess).
      const resources = probeHostResources();
      const sizing = computePoolSizing(resources, {
        maxProcesses: this.initOpts.maxProcesses,
        maxContextsPerProcess: this.initOpts.maxContextsPerProcess,
      });

      await Promise.all(
        Array.from({ length: sizing.contextsPerProcess }, () =>
          this._addContext(proc),
        ),
      );

      this._watchProcess(proc);
      this._drainQueue();
    } catch {
      // Restart failed — remove the process
      this.processes = this.processes.filter((p) => p !== proc);
      this._drainQueue();
    }
  }

  /** Drain the wait queue using currently idle contexts. */
  private _drainQueue(): void {
    while (this.waitQueue.length > 0) {
      const ctx = this._findIdleContext();
      if (!ctx) break;
      ctx.state = "busy";
      const waiter = this.waitQueue.shift()!;
      waiter.resolve({ contextId: ctx.contextId, adapterId: ctx.adapterId });
    }
  }

  private async _closeProcess(proc: ManagedProcess): Promise<void> {
    // Close all contexts first
    for (const ctx of proc.contexts) {
      if (ctx.state !== "failed") {
        try {
          await proc.adapter.closeContext(ctx.contextId);
        } catch {
          // best-effort
        }
      }
    }
    proc.contexts = [];
    try {
      await proc.adapter.close();
    } catch {
      // best-effort
    }
  }

}
