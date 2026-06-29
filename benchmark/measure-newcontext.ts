/**
 * newContext() の各ステップを計測する
 */
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";

// ---- minimal CDP session ----
class WS {
  ws: WebSocket;
  id = 0;
  constructor(url: string) { this.ws = new WebSocket(url); }
  async ready() {
    await new Promise<void>((r) => (this.ws.onopen = () => r()));
  }
  send<T>(method: string, params?: object): Promise<T> {
    return new Promise((resolve) => {
      const id = ++this.id;
      const handler = (ev: MessageEvent) => {
        const msg = JSON.parse(ev.data as string) as { id?: number; result?: T };
        if (msg.id === id) {
          this.ws.removeEventListener("message", handler);
          resolve(msg.result as T);
        }
      };
      this.ws.addEventListener("message", handler);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  waitForEvent(method: string): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      const handler = (ev: MessageEvent) => {
        const msg = JSON.parse(ev.data as string) as { method?: string; params?: Record<string, unknown> };
        if (msg.method === method) {
          this.ws.removeEventListener("message", handler);
          resolve(msg.params ?? {});
        }
      };
      this.ws.addEventListener("message", handler);
    });
  }
}

function httpGet(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let raw = "";
      res.on("data", (c: string) => (raw += c));
      res.on("end", () => resolve(JSON.parse(raw)));
    });
    req.on("error", reject);
  });
}

// ---- launch Chromium ----
const CHROME = "/Users/midori/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PORT = 19500;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kaze-bench-"));

const proc = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, "--headless=new",
  "--no-sandbox", "--disable-gpu", "--disable-gpu-sandbox",
  "--disable-dev-shm-usage", "--disable-crash-reporter",
  "--disable-breakpad", "--use-angle=swiftshader",
  "--disable-background-networking", "--disable-extensions",
  "--disable-sync", "--password-store=basic", "--use-mock-keychain",
  `--user-data-dir=${tmpDir}`,
], { stdio: "ignore", detached: true });
proc.unref();

// Wait for DevTools
await new Promise<void>((r) => setTimeout(r, 1500));

const version = await httpGet(`http://127.0.0.1:${PORT}/json/version`) as { webSocketDebuggerUrl: string };
const browser = new WS(version.webSocketDebuggerUrl);
await browser.ready();

// Enable target discovery
await browser.send("Target.setDiscoverTargets", { discover: true });

// ---- Measure each step ----
const t = (label: string) => {
  const t0 = performance.now();
  return () => console.log(`  ${label}: ${Math.round(performance.now() - t0)}ms`);
};

console.log("newContext() breakdown:");

let done = t("Target.createTarget + targetCreated event");
const eventPromise = browser.waitForEvent("Target.targetCreated");
const { targetId } = await browser.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
await eventPromise;
done();

done = t("WebSocket connect to page");
const ws = new WS(`ws://127.0.0.1:${PORT}/devtools/page/${targetId}`);
await ws.ready();
done();

done = t("Runtime.enable");
await ws.send("Runtime.enable");
done();

done = t("Page.enable");
await ws.send("Page.enable");
done();

// cleanup
proc.kill(-proc.pid!, "SIGKILL");
fs.rmSync(tmpDir, { recursive: true, force: true });
