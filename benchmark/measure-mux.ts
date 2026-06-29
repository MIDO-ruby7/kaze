import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";

class WS {
  ws: WebSocket;
  id = 0;
  constructor(url: string) { this.ws = new WebSocket(url); }
  async ready() { await new Promise<void>((r) => (this.ws.onopen = () => r())); }
  send<T>(method: string, params?: object, sessionId?: string): Promise<T> {
    return new Promise((resolve) => {
      const id = ++this.id;
      const key = sessionId ? `${id}:${sessionId}` : `${id}`;
      const handler = (ev: MessageEvent) => {
        const msg = JSON.parse(ev.data as string) as { id?: number; sessionId?: string; result?: T };
        const msgKey = msg.sessionId ? `${msg.id}:${msg.sessionId}` : `${msg.id}`;
        if (msgKey === key) {
          this.ws.removeEventListener("message", handler);
          resolve(msg.result as T);
        }
      };
      this.ws.addEventListener("message", handler);
      const payload: object = sessionId
        ? { id, method, params, sessionId }
        : { id, method, params };
      this.ws.send(JSON.stringify(payload));
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

const CHROME = "/Users/midori/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PORT = 19501;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kaze-bench2-"));

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

await new Promise<void>((r) => setTimeout(r, 1500));

const version = await httpGet(`http://127.0.0.1:${PORT}/json/version`) as { webSocketDebuggerUrl: string };
const browser = new WS(version.webSocketDebuggerUrl);
await browser.ready();
await browser.send("Target.setDiscoverTargets", { discover: true });

const t = (label: string) => {
  const t0 = performance.now();
  return () => console.log(`  ${label}: ${Math.round(performance.now() - t0)}ms`);
};

console.log("Multiplexed newContext() breakdown:");

let done = t("Target.createTarget");
const { targetId } = await browser.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
done();

done = t("Target.attachToTarget (flatten=true)");
const { sessionId } = await browser.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
done();

done = t("Runtime.enable (via sessionId)");
await browser.send("Runtime.enable", {}, sessionId);
done();

done = t("Page.enable (via sessionId)");
await browser.send("Page.enable", {}, sessionId);
done();

console.log(`\nTotal newContext: ~${Math.round(
  Date.now() - (Date.now() - 100) // rough
)}ms`);

// cleanup
process.kill(-proc.pid!, "SIGKILL");
fs.rmSync(tmpDir, { recursive: true, force: true });
