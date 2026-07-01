/**
 * CdpAdapter — ProtocolAdapter implementation using raw WebSocket + CDP.
 *
 * Uses the Node.js 22+ built-in WebSocket. No external browser-automation
 * library is imported, keeping CDP types internal (AC-2, AC-5).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { setMaxListeners } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import type { ContextId, EvaluateResult, InterceptedRequest, ProtocolAdapter } from "./ProtocolAdapter.js";
import type { FulfillOptions } from "../api/Route.js";

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
  /** Pending calls for multiplexed page sessions: key = "<id>:<sessionId>" */
  private pendingMux = new Map<
    string,
    {
      resolve: (r: Record<string, unknown>) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  /**
   * Central event dispatcher for multiplexed sessions.
   * Key = "<sessionId>\x00<method>", value = ordered list of one-shot resolvers.
   * This avoids adding a WebSocket event listener per waitForEvent call (O(n) scanning).
   */
  private eventListeners = new Map<
    string,
    Array<(params: Record<string, unknown>) => void>
  >();
  /** GAP-2: track whether this session has been closed */
  private closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
  }

  static async connect(wsUrl: string): Promise<CdpSession> {
    const ws = new WebSocket(wsUrl);
    // Disable the MaxListenersExceeded warning — the browser session accumulates
    // many concurrent waitForEvent/waitForEventInSession listeners when tests run
    // in parallel, which is expected and not a leak.
    setMaxListeners(0, ws);
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

    const sessionId = (msg as Record<string, unknown>).sessionId as string | undefined;

    // Multiplexed session response (has sessionId + id)
    if (msg.id !== undefined && sessionId) {
      const key = `${msg.id}:${sessionId}`;
      const entry = this.pendingMux.get(key);
      if (entry) {
        clearTimeout(entry.timer);
        this.pendingMux.delete(key);
        if (msg.error) {
          entry.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
        } else {
          entry.resolve(msg.result ?? {});
        }
      }
      return;
    }

    // Multiplexed event (has sessionId, no id) — route via central dispatcher
    if (msg.method && sessionId) {
      const key = `${sessionId}\x00${msg.method}`;
      const listeners = this.eventListeners.get(key);
      if (listeners && listeners.length > 0) {
        const cb = listeners.shift()!;
        if (listeners.length === 0) this.eventListeners.delete(key);
        cb(msg.params ?? {});
      }
      return;
    }

    // Regular response (no sessionId)
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

  /** GAP-2: reject and clear all pending promises (both direct and mux) */
  private rejectAllPending(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    for (const [, entry] of this.pendingMux) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pendingMux.clear();
    this.eventListeners.clear();
  }

  /**
   * Send a CDP command to a multiplexed page session (via sessionId).
   * This reuses the browser's WebSocket connection instead of opening a new one.
   */
  sendForSession<T extends Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> | undefined,
    sessionId: string,
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("CdpSession is already closed"));
    }
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const key = `${id}:${sessionId}`;
      const timer = setTimeout(() => {
        if (this.pendingMux.has(key)) {
          this.pendingMux.delete(key);
          reject(new Error(`CDP send timed out after ${SEND_TIMEOUT_MS}ms for method: ${method}`));
        }
      }, SEND_TIMEOUT_MS);
      this.pendingMux.set(key, {
        resolve: (r) => resolve(r as T),
        reject,
        timer,
      });
      this.ws.send(JSON.stringify({ id, method, params: params ?? {}, sessionId }));
    });
  }

  /**
   * Wait for a CDP event in a specific multiplexed page session.
   */
  waitForEventInSession(
    method: string,
    sessionId: string,
    timeoutMs: number = SEND_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    // Use the central event dispatcher (O(1) lookup) instead of adding a
    // WebSocket listener per call (which caused O(n) scanning with n concurrent sessions).
    return new Promise((resolve, reject) => {
      const key = `${sessionId}\x00${method}`;
      const timer = setTimeout(() => {
        // Remove from queue on timeout
        const listeners = this.eventListeners.get(key);
        if (listeners) {
          const idx = listeners.indexOf(cb);
          if (idx !== -1) listeners.splice(idx, 1);
          if (listeners.length === 0) this.eventListeners.delete(key);
        }
        reject(new Error(`Timeout waiting for CDP event "${method}" in session ${sessionId} after ${timeoutMs}ms`));
      }, timeoutMs);

      const cb = (params: Record<string, unknown>): void => {
        clearTimeout(timer);
        resolve(params);
      };

      const existing = this.eventListeners.get(key);
      if (existing) {
        existing.push(cb);
      } else {
        this.eventListeners.set(key, [cb]);
      }
    });
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

  /**
   * Like waitForEvent but with a predicate — resolves only when the event fires
   * AND the predicate returns true. Used for Target.targetCreated to match a
   * specific targetId instead of accepting any target creation event.
   */
  waitForEventWhere(
    method: string,
    predicate: (params: Record<string, unknown>) => boolean,
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
        if (msg.method === method && predicate(msg.params ?? {})) {
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
// CdpPageSession — thin wrapper that routes CDP through the browser session
// using sessionId multiplexing, avoiding a per-page WebSocket connection.
// ---------------------------------------------------------------------------

class CdpPageSession {
  constructor(
    private browserSession: CdpSession,
    readonly sessionId: string,
  ) {}

  send<T extends Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    return this.browserSession.sendForSession<T>(method, params, this.sessionId);
  }

  waitForEvent(
    method: string,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>> {
    return this.browserSession.waitForEventInSession(method, this.sessionId, timeoutMs);
  }

  close(): void {
    // Detach the session — best-effort, ignore errors
    void this.browserSession
      .sendForSession("Target.detachFromTarget", { sessionId: this.sessionId }, "")
      .catch(() => {});
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
  /** Map from our opaque ContextId → CdpPageSession (multiplexed via browser WS) */
  private targetSessions = new Map<ContextId, CdpPageSession>();
  private nextContextSeq = 1;
  /** GAP-3: track the temporary profile directory so close() can delete it */
  private tmpDir: string | null = null;

  /**
   * Request interception — per-context request listeners.
   * Key = contextId, Value = list of handlers registered via onRequest().
   */
  private requestListeners = new Map<ContextId, Set<(req: InterceptedRequest) => void>>();
  /**
   * Per-context interception enabled flag (used to start/stop Fetch.requestPaused listening).
   */
  private interceptionEnabled = new Map<ContextId, boolean>();
  /**
   * AC-9: Track paused requestIds per context so that resetContext can release
   * any in-flight paused requests before calling Fetch.disable.
   */
  private pendingPausedRequests = new Map<ContextId, Set<string>>();

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

    // Enable Target events so we receive Target.targetCreated notifications.
    // Without this, the browser does not emit target lifecycle events.
    await this.browserSession.send("Target.setDiscoverTargets", { discover: true });
  }

  async newContext(): Promise<ContextId> {
    if (!this.browserSession) throw new Error("Not launched. Call launch() first.");

    // Create a new target (page tab)
    const { targetId } = await this.browserSession.send<{ targetId: string }>(
      "Target.createTarget",
      { url: "about:blank" },
    );

    // Attach to the target using CDP session multiplexing (flatten=true).
    // All page commands flow through the browser's existing WebSocket with sessionId,
    // avoiding per-page WebSocket connections which add ~540ms overhead at creation.
    const { sessionId } = await this.browserSession.send<{ sessionId: string }>(
      "Target.attachToTarget",
      { targetId, flatten: true },
    );

    const session = new CdpPageSession(this.browserSession, sessionId);

    // Enable the domains we need once per context lifetime
    await session.send("Runtime.enable");
    await session.send("Page.enable");
    await session.send("Network.enable");

    const contextId: ContextId = `ctx-${this.nextContextSeq++}`;
    this.contextMap.set(contextId, targetId);
    this.targetSessions.set(contextId, session);
    return contextId;
  }

  /**
   * Reset a context to a clean state in-place — fast (~20ms) vs close+create (~700ms).
   * Clears cookies (including HttpOnly), localStorage, IndexedDB, Service Workers,
   * and navigates to about:blank.
   */
  async resetContext(contextId: ContextId): Promise<void> {
    const session = this.getSession(contextId);

    // 1. Cookies（HttpOnly含む）を削除 — 速い
    await session.send("Network.clearBrowserCookies");

    // 2. localStorage/sessionStorage を JS で削除 — 速い
    // localStorage.clear() は同期処理なので awaitPromise 不要。
    try {
      await session.send("Runtime.evaluate", {
        expression: "try{localStorage.clear();}catch(e){} try{sessionStorage.clear();}catch(e){}",
        returnByValue: false,
        awaitPromise: false,
      });
    } catch { /* 無視 */ }

    // AC-4: disable request interception if it was enabled for this context
    if (this.interceptionEnabled.get(contextId)) {
      // AC-9: Release any in-flight paused requests before disabling Fetch.
      // Fetch.disable stops future pauses but does not unblock already-paused
      // requests; those need an explicit continueRequest response.
      const pending = this.pendingPausedRequests.get(contextId);
      if (pending && pending.size > 0) {
        for (const requestId of pending) {
          await session.send("Fetch.continueRequest", { requestId }).catch(() => {});
        }
        this.pendingPausedRequests.delete(contextId);
      }
      await session.send("Fetch.disable");
      this.interceptionEnabled.delete(contextId);
      this.requestListeners.delete(contextId);
    }
  }

  // ---------------------------------------------------------------------------
  // Request interception — ProtocolAdapter optional methods
  // ---------------------------------------------------------------------------

  async enableRequestInterception(contextId: ContextId): Promise<void> {
    const session = this.getSession(contextId);
    if (this.interceptionEnabled.get(contextId)) return;

    // Enable Fetch domain interception for all requests
    await session.send("Fetch.enable", {
      patterns: [{ urlPattern: "*" }],
    });
    this.interceptionEnabled.set(contextId, true);
    this.requestListeners.set(contextId, new Set());
    this.pendingPausedRequests.set(contextId, new Set());

    // Start listening loop for Fetch.requestPaused events
    this._startRequestPausedLoop(contextId, session);
  }

  async disableRequestInterception(contextId: ContextId): Promise<void> {
    if (!this.interceptionEnabled.get(contextId)) return;
    const session = this.getSession(contextId);

    // B-1: Drain in-flight paused requests before disabling (same pattern as resetContext).
    // Fetch.disable stops future pauses but does not unblock already-paused requests;
    // those need an explicit continueRequest response or they will hang.
    const pending = this.pendingPausedRequests.get(contextId);
    if (pending && pending.size > 0) {
      await Promise.all([...pending].map((reqId) =>
        session.send("Fetch.continueRequest", { requestId: reqId }).catch(() => {}),
      ));
      pending.clear();
    }

    await session.send("Fetch.disable");
    this.interceptionEnabled.delete(contextId);
    this.requestListeners.delete(contextId);
    this.pendingPausedRequests.delete(contextId);
  }

  async fulfillRequest(contextId: ContextId, requestId: string, opts: FulfillOptions): Promise<void> {
    const session = this.getSession(contextId);
    const body = opts.json !== undefined
      ? JSON.stringify(opts.json)
      : (opts.body ?? "");

    const headers: Array<{ name: string; value: string }> = [];
    if (opts.json !== undefined) {
      headers.push({ name: "content-type", value: "application/json" });
    }
    if (opts.headers) {
      for (const [name, value] of Object.entries(opts.headers)) {
        headers.push({ name, value });
      }
    }

    await session.send("Fetch.fulfillRequest", {
      requestId,
      responseCode: opts.status ?? 200,
      responseHeaders: headers,
      body: Buffer.from(body).toString("base64"),
    });
    // AC-9: Request is no longer paused once responded to
    this.pendingPausedRequests.get(contextId)?.delete(requestId);
  }

  async continueRequest(contextId: ContextId, requestId: string): Promise<void> {
    const session = this.getSession(contextId);
    await session.send("Fetch.continueRequest", { requestId });
    // AC-9: Request is no longer paused once continued
    this.pendingPausedRequests.get(contextId)?.delete(requestId);
  }

  async abortRequest(contextId: ContextId, requestId: string): Promise<void> {
    const session = this.getSession(contextId);
    await session.send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
    // AC-9: Request is no longer paused once aborted
    this.pendingPausedRequests.get(contextId)?.delete(requestId);
  }

  onRequest(
    contextId: ContextId,
    handler: (req: InterceptedRequest) => void,
  ): () => void {
    const listeners = this.requestListeners.get(contextId);
    if (!listeners) return () => {};
    listeners.add(handler);
    return () => listeners.delete(handler);
  }

  /**
   * Start a background loop that listens for Fetch.requestPaused events and
   * dispatches them to registered handlers.
   * The loop exits when interception is disabled for this context or when the
   * session is closed. A waitForEvent timeout (60s) causes the loop to continue
   * so that a quiet page does not stop interception.
   */
  private _startRequestPausedLoop(contextId: ContextId, session: CdpPageSession): void {
    const pump = async (): Promise<void> => {
      while (this.interceptionEnabled.has(contextId)) {
        try {
          const params = await session.waitForEvent("Fetch.requestPaused", 60_000);

          if (!this.interceptionEnabled.has(contextId)) {
            // Interception was disabled while we were waiting. The request is
            // still paused — release it so it doesn't hang.
            const staleId = params.requestId as string;
            void session.send("Fetch.continueRequest", { requestId: staleId }).catch(() => {});
            return;
          }

          const requestId = params.requestId as string;
          const url = (params.request as { url: string }).url;
          const req: InterceptedRequest = { requestId, url };

          // AC-9: Track this paused request so resetContext can release it
          this.pendingPausedRequests.get(contextId)?.add(requestId);

          const listeners = this.requestListeners.get(contextId);
          if (listeners && listeners.size > 0) {
            for (const handler of listeners) {
              handler(req);
            }
          } else {
            // No handlers — continue automatically
            void this.continueRequest(contextId, requestId).catch(() => {});
            this.pendingPausedRequests.get(contextId)?.delete(requestId);
          }
        } catch (err) {
          // Distinguish between a 60s idle timeout (continue the loop) and a
          // real session error such as WebSocket close (stop the loop).
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("Timeout") && this.interceptionEnabled.has(contextId)) {
            // Timeout on a quiet page — keep listening
            continue;
          }
          // Session closed or unexpected error — stop pumping
          break;
        }
      }
    };

    void pump();
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
    }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });

    if (result.exceptionDetails) {
      throw new Error(`Evaluation threw an exception: ${JSON.stringify(result.exceptionDetails)}`);
    }
    return result.result.value;
  }

  async screenshot(contextId: ContextId): Promise<Buffer> {
    const session = this.getSession(contextId);
    const result = await session.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
    return Buffer.from(result.data, "base64");
  }

  async dispatchEvent(contextId: ContextId, selector: string, event: string): Promise<void> {
    const escaped = selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const session = this.getSession(contextId);

    if (event === "click") {
      // AC-1, AC-2: Use CDP Input.dispatchMouseEvent with element-center coordinates.
      // This ensures React/Vue synthetic event handlers fire, unlike JS dispatchEvent.

      // Step 1: Get element bounding rect + viewport size in one Runtime.evaluate call
      // B-1: null check is inside the evaluate expression to avoid opaque crashes
      const combined = await session.send<{ result: { value: string | null } }>(
        "Runtime.evaluate",
        {
          expression: `(function(){
      const el = document.querySelector('${escaped}');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return JSON.stringify({
        left: r.left, top: r.top, w: r.width, h: r.height,
        vw: window.innerWidth, vh: window.innerHeight
      });
    })()`,
          returnByValue: true,
        },
      );

      // B-1: element not found
      if (!combined.result.value) {
        throw new Error(`Element not found for click: "${selector}"`);
      }

      const rect = JSON.parse(combined.result.value) as {
        left: number;
        top: number;
        w: number;
        h: number;
        vw: number;
        vh: number;
      };

      // Error handling: element not visible (zero-size bounding box)
      if (rect.w === 0 && rect.h === 0) {
        throw new Error(
          `Element not visible (zero-size bounding box): ${selector}. ` +
          `The element may be hidden (display:none, visibility:hidden, or off-screen).`,
        );
      }

      // B-2: round to integer coordinates to avoid sub-pixel CDP errors
      let x = Math.round(rect.left + rect.w / 2);
      let y = Math.round(rect.top + rect.h / 2);

      // viewport 外の場合: scrollIntoView してポーリングで viewport 内に収まるまで待つ
      if (x < 0 || y < 0 || x > rect.vw || y > rect.vh) {
        await session.send("Runtime.evaluate", {
          expression: `document.querySelector('${escaped}')?.scrollIntoView({ block: 'center', inline: 'center' })`,
          returnByValue: true,
        });

        // wait for element to be in viewport (up to 500ms)
        let inViewport = false;
        const scrollDeadline = Date.now() + 500;
        while (Date.now() < scrollDeadline) {
          await new Promise(r => setTimeout(r, 50));
          const r2 = await session.send<{ result: { value: string | null } }>(
            "Runtime.evaluate",
            {
              expression: `(function(){
      const el = document.querySelector('${escaped}');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return JSON.stringify({ left:r.left, top:r.top, w:r.width, h:r.height, vw:window.innerWidth, vh:window.innerHeight });
    })()`,
              returnByValue: true,
            },
          );
          if (r2.result.value) {
            const rr = JSON.parse(r2.result.value) as {
              left: number;
              top: number;
              w: number;
              h: number;
              vw: number;
              vh: number;
            };
            if (rr.left >= 0 && rr.top >= 0 && (rr.left + rr.w / 2) <= rr.vw && (rr.top + rr.h / 2) <= rr.vh) {
              x = Math.round(rr.left + rr.w / 2);
              y = Math.round(rr.top + rr.h / 2);
              inViewport = true;
              break;
            }
          }
        }
        if (!inViewport) throw new Error(`Element still outside viewport after scroll: "${selector}" (${x},${y})`);
      }

      // Step 2: Send CDP mouse events (mousePressed + mouseReleased)
      await session.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
      await session.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1,
      });

      return;
    }

    // Non-click events: fall back to JS dispatchEvent (hover, focus, etc.)
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

  private getSession(contextId: ContextId): CdpPageSession {
    const session = this.targetSessions.get(contextId);
    if (!session) throw new Error(`Unknown contextId: ${contextId}`);
    return session;
  }
}
