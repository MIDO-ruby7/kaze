/**
 * CdpAdapter — ProtocolAdapter implementation using raw WebSocket + CDP.
 *
 * Uses the Node.js 22+ built-in WebSocket. No external browser-automation
 * library is imported, keeping CDP types internal (AC-2, AC-5).
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import type { ContextId, EvaluateResult, ProtocolAdapter } from "./ProtocolAdapter.js";

// ---------------------------------------------------------------------------
// Internal CDP types — never exported (AC-5)
// ---------------------------------------------------------------------------

interface CdpResponse {
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
  method?: string;
  params?: Record<string, unknown>;
}

interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHROMIUM_BIN_NAMES =
  process.platform === "darwin"
    ? ["Google Chrome for Testing", "chrome", "Chromium"]
    : process.platform === "win32"
      ? ["chrome.exe"]
      : ["chrome", "chromium", "chrome-linux"];

function findFileRecursive(dir: string, name: string): string | undefined {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return undefined;
}

/** Locate the Chromium executable inside an install directory. */
export function resolveChromiumExecutable(installDir: string): string {
  for (const bin of CHROMIUM_BIN_NAMES) {
    const found = findFileRecursive(installDir, bin);
    if (found) return found;
  }
  throw new Error(
    `Could not find Chromium executable in ${installDir}. ` +
      `Looked for: ${CHROMIUM_BIN_NAMES.join(", ")}`,
  );
}

/** Default install root: ~/.kaze/browsers */
function browsersDir(): string {
  return path.join(os.homedir(), ".kaze", "browsers");
}

/**
 * Find the latest installed chromium-* directory under the browsers dir.
 * Throws if none found.
 */
function findLatestInstalledChromiumDir(): string {
  // 1. Prefer Playwright's Chromium cache (properly signed for macOS)
  const playwrightCacheDirs = [
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright"),
  ];
  for (const cacheDir of playwrightCacheDirs) {
    if (!fs.existsSync(cacheDir)) continue;
    const chromiumDirs = fs
      .readdirSync(cacheDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith("chromium-"))
      .map((e) => path.join(cacheDir, e.name))
      .sort();
    if (chromiumDirs.length > 0) return chromiumDirs[chromiumDirs.length - 1]!;
  }

  // 2. Fall back to kaze's own downloaded Chromium
  const root = browsersDir();
  if (!fs.existsSync(root)) {
    throw new Error(`No browsers installed under ${root}. Run installBrowser() first.`);
  }
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("chromium-"))
    .map((e) => path.join(root, e.name));

  if (dirs.length === 0) {
    throw new Error(`No chromium-* directories found in ${root}.`);
  }

  dirs.sort();
  return dirs[dirs.length - 1]!;
}

/** Fetch JSON from a local HTTP endpoint. */
function httpGetJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (raw += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(raw) as T);
        } catch (e) {
          reject(e);
        }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}

/** Wait until the CDP /json/version endpoint is reachable. */
async function waitForDevTools(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await httpGetJson<unknown>(`http://127.0.0.1:${port}/json/version`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`CDP DevTools not reachable on port ${port} after ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// CdpSession — a single WebSocket connection to a CDP target
// ---------------------------------------------------------------------------

/** GAP-2: 30-second timeout for each CDP send call */
const SEND_TIMEOUT_MS = 30_000;

class CdpSession {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (r: Record<string, unknown>) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  /** GAP-2: track whether this session has been closed */
  private closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
  }

  static async connect(wsUrl: string): Promise<CdpSession> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", (ev) => reject(new Error(`WebSocket error: ${String(ev)}`)));
    });
    const session = new CdpSession(ws);
    ws.addEventListener("message", (ev) => session.handleMessage(ev.data as string));
    // GAP-2: sweep pending on WebSocket close event
    ws.addEventListener("close", () => {
      session.rejectAllPending(new Error("WebSocket closed unexpectedly"));
    });
    return session;
  }

  private handleMessage(data: string): void {
    let msg: CdpResponse;
    try {
      msg = JSON.parse(data) as CdpResponse;
    } catch {
      return;
    }
    if (msg.id !== undefined) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
        } else {
          pending.resolve(msg.result ?? {});
        }
      }
    }
  }

  /** GAP-2: reject and clear all pending promises */
  private rejectAllPending(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  send<T extends Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T> {
    // GAP-2: immediately reject if already closed
    if (this.closed) {
      return Promise.reject(new Error("CdpSession is already closed"));
    }
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      // GAP-2: 30-second per-call timeout
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(
            new Error(`CDP send timed out after ${SEND_TIMEOUT_MS}ms for method: ${method}`),
          );
        }
      }, SEND_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (r) => resolve(r as T),
        reject,
        timer,
      });
      this.ws.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  }

  /**
   * Register a one-shot listener for a CDP event.
   * Returns a Promise that resolves with the event params when the event fires.
   * GAP-1: used by navigate() to await Page.loadEventFired.
   */
  waitForEvent(
    method: string,
    timeoutMs: number = SEND_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ws.removeEventListener("message", handler);
        reject(new Error(`Timeout waiting for CDP event "${method}" after ${timeoutMs}ms`));
      }, timeoutMs);

      const handler = (ev: MessageEvent): void => {
        let msg: CdpResponse;
        try {
          msg = JSON.parse(ev.data as string) as CdpResponse;
        } catch {
          return;
        }
        if (msg.method === method) {
          clearTimeout(timer);
          this.ws.removeEventListener("message", handler);
          resolve(msg.params ?? {});
        }
      };

      this.ws.addEventListener("message", handler);
    });
  }

  /** GAP-2: close() rejects all pending promises before closing the socket */
  close(): void {
    this.closed = true;
    this.rejectAllPending(new Error("CdpSession was closed"));
    this.ws.close();
  }
}

// ---------------------------------------------------------------------------
// CdpAdapter
// ---------------------------------------------------------------------------

export interface CdpAdapterOptions {
  /**
   * Absolute path to the Chromium executable.
   * Defaults to the latest version found in ~/.kaze/browsers/.
   */
  executablePath?: string;
  /** CDP remote-debugging port. Defaults to 9222. */
  port?: number;
}

export class CdpAdapter implements ProtocolAdapter {
  private readonly options: Required<CdpAdapterOptions>;
  private process: ChildProcess | null = null;
  private browserSession: CdpSession | null = null;
  /** Map from our opaque ContextId → CDP targetId */
  private contextMap = new Map<ContextId, string>();
  /** Map from our opaque ContextId → CdpSession for that target */
  private targetSessions = new Map<ContextId, CdpSession>();
  private nextContextSeq = 1;
  /** GAP-3: track the temporary profile directory so close() can delete it */
  private tmpDir: string | null = null;

  constructor(options: CdpAdapterOptions = {}) {
    const port = options.port ?? 9222;
    let executablePath = options.executablePath;
    if (!executablePath) {
      const installDir = findLatestInstalledChromiumDir();
      executablePath = resolveChromiumExecutable(installDir);
    }
    this.options = { executablePath, port };
  }

  // -------------------------------------------------------------------------
  // ProtocolAdapter implementation
  // -------------------------------------------------------------------------

  async launch(): Promise<void> {
    const { executablePath, port } = this.options;
    // GAP-3: remember tmpDir so close() can remove it
    this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kaze-profile-"));

    this.process = spawn(
      executablePath,
      [
        `--remote-debugging-port=${port}`,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-gpu-sandbox",
        "--disable-dev-shm-usage",
        "--disable-crash-reporter",
        "--disable-breakpad",
        "--use-angle=swiftshader",
        "--disable-software-rasterizer",
        "--disable-background-networking",
        "--disable-extensions",
        "--disable-sync",
        "--password-store=basic",
        "--use-mock-keychain",
        `--user-data-dir=${this.tmpDir}`,
      ],
      {
        stdio: "ignore",
        // detached=true puts the browser in its own process group so we can
        // kill the entire group (browser + GPU process + renderer etc.) at once.
        detached: true,
      },
    );
    // Unref so the Node.js process doesn't wait for Chromium if we forget close()
    this.process.unref();

    await waitForDevTools(port);

    const versionInfo = await httpGetJson<{ webSocketDebuggerUrl: string }>(
      `http://127.0.0.1:${port}/json/version`,
    );
    this.browserSession = await CdpSession.connect(versionInfo.webSocketDebuggerUrl);
  }

  async newContext(): Promise<ContextId> {
    if (!this.browserSession) throw new Error("Not launched. Call launch() first.");

    const { targetId } = await this.browserSession.send<{ targetId: string }>(
      "Target.createTarget",
      { url: "about:blank" },
    );

    // Wait for the target to appear in /json/list (timing varies across Chrome versions)
    const wsUrl = await this._waitForTarget(targetId);
    const session = await CdpSession.connect(wsUrl);

    // Enable the domains we need
    await session.send("Runtime.enable");
    await session.send("Page.enable");

    const contextId: ContextId = `ctx-${this.nextContextSeq++}`;
    this.contextMap.set(contextId, targetId);
    this.targetSessions.set(contextId, session);
    return contextId;
  }

  async closeContext(contextId: ContextId): Promise<void> {
    const session = this.getSession(contextId);
    session.close();
    this.targetSessions.delete(contextId);

    const targetId = this.contextMap.get(contextId)!;
    this.contextMap.delete(contextId);

    if (this.browserSession) {
      await this.browserSession.send("Target.closeTarget", { targetId });
    }
  }

  /** Wait for a target to be ready, then return its direct WebSocket URL. */
  private async _waitForTarget(targetId: string, timeoutMs = 5000): Promise<string> {
    const wsUrl = `ws://127.0.0.1:${this.options.port}/devtools/page/${targetId}`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // Verify via CDP Target.getTargets (more reliable than /json/list in newer Chrome)
      const result = await this.browserSession!.send<{ targetInfos: TargetInfo[] }>(
        "Target.getTargets",
      );
      if (result.targetInfos.some((t) => t.targetId === targetId)) {
        return wsUrl;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Target ${targetId} did not become ready within ${timeoutMs}ms`);
  }

  async navigate(contextId: ContextId, url: string): Promise<void> {
    const session = this.getSession(contextId);
    // GAP-1: arm the listener before sending the command so no event is missed
    const loadFired = session.waitForEvent("Page.loadEventFired");
    await session.send("Page.navigate", { url });
    await loadFired;
  }

  async evaluate(contextId: ContextId, expression: string): Promise<EvaluateResult> {
    const session = this.getSession(contextId);
    const result = await session.send<{
      result: { type: string; value?: unknown; description?: string };
      exceptionDetails?: unknown;
    }>("Runtime.evaluate", { expression, returnByValue: true });

    if (result.exceptionDetails) {
      throw new Error(`Evaluation threw an exception: ${JSON.stringify(result.exceptionDetails)}`);
    }
    return result.result.value;
  }

  async dispatchEvent(contextId: ContextId, selector: string, event: string): Promise<void> {
    const escaped = selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const escapedEvent = event.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const expression = `
      (function() {
        const el = document.querySelector('${escaped}');
        if (!el) throw new Error('Element not found: ${escaped}');
        el.dispatchEvent(new Event('${escapedEvent}', { bubbles: true, cancelable: true }));
      })()
    `;
    await this.evaluate(contextId, expression);
  }

  async close(): Promise<void> {
    // Close all target sessions
    for (const [, session] of this.targetSessions) {
      session.close();
    }
    this.targetSessions.clear();
    this.contextMap.clear();

    if (this.browserSession) {
      this.browserSession.close();
      this.browserSession = null;
    }

    if (this.process) {
      const proc = this.process;
      this.process = null;

      await new Promise<void>((resolve) => {
        proc.once("exit", resolve);

        // Kill the entire process group (negative PID) to ensure all
        // child processes (GPU, renderer, crashpad) are terminated.
        const killGroup = (signal: NodeJS.Signals): void => {
          try {
            if (proc.pid !== undefined) {
              process.kill(-proc.pid, signal);
            }
          } catch {
            // Process already dead or no group — fall back to direct kill
            try { proc.kill(signal); } catch { /* already gone */ }
          }
        };

        killGroup("SIGTERM");

        // If still alive after 1s, escalate to SIGKILL
        const sigkillTimer = setTimeout(() => {
          killGroup("SIGKILL");
          // Hard deadline — resolve even if exit event never fires
          setTimeout(resolve, 1000);
        }, 1000);

        proc.once("exit", () => clearTimeout(sigkillTimer));
      });
    }

    // GAP-3: delete the temporary profile directory
    if (this.tmpDir) {
      try {
        fs.rmSync(this.tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup; do not throw
      }
      this.tmpDir = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private getSession(contextId: ContextId): CdpSession {
    const session = this.targetSessions.get(contextId);
    if (!session) throw new Error(`Unknown contextId: ${contextId}`);
    return session;
  }
}
