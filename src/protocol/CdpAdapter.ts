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

  // Sort lexicographically; last entry is the highest version
  dirs.sort();
  return dirs[dirs.length - 1]!;
}

/** Fetch JSON from a local HTTP endpoint. */
function httpGetJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
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

class CdpSession {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }
  >();

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
        this.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
        } else {
          pending.resolve(msg.result ?? {});
        }
      }
    }
  }

  send<T extends Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, {
        resolve: (r) => resolve(r as T),
        reject,
      });
      this.ws.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  }

  close(): void {
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
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kaze-profile-"));

    this.process = spawn(
      executablePath,
      [
        `--remote-debugging-port=${port}`,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        `--user-data-dir=${tmpDir}`,
      ],
      { stdio: "ignore" },
    );

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

    // Open a dedicated session for this target
    const { sessionId } = await this.browserSession.send<{ sessionId: string }>(
      "Target.attachToTarget",
      { targetId, flatten: false },
    );
    void sessionId; // We open a direct WS connection instead

    const targets = await httpGetJson<TargetInfo[]>(
      `http://127.0.0.1:${this.options.port}/json/list`,
    );
    const target = targets.find((t) => t.targetId === targetId);
    if (!target) throw new Error(`Target ${targetId} not found in /json/list`);

    const wsUrl = `ws://127.0.0.1:${this.options.port}/devtools/page/${targetId}`;
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

  async navigate(contextId: ContextId, url: string): Promise<void> {
    const session = this.getSession(contextId);
    await session.send("Page.navigate", { url });
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
    const expression = `
      (function() {
        const el = document.querySelector('${escaped}');
        if (!el) throw new Error('Element not found: ${escaped}');
        el.dispatchEvent(new Event('${event}', { bubbles: true, cancelable: true }));
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
      this.process.kill();
      await new Promise<void>((resolve) => {
        this.process!.once("exit", () => resolve());
        setTimeout(resolve, 3000); // safety timeout
      });
      this.process = null;
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
