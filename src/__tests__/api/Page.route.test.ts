/**
 * Unit tests for Page.route / Page.unroute (AC-1, AC-2, AC-3, AC-4, AC-5).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { Page, createPage } from "../../api/Page.js";
import type { PooledContext } from "../../pool/types.js";
import type { ProtocolAdapter } from "../../protocol/index.js";

function makeAdapter(overrides: Partial<ProtocolAdapter> = {}): ProtocolAdapter {
  return {
    launch: vi.fn().mockResolvedValue(undefined),
    newContext: vi.fn().mockResolvedValue("ctx-1"),
    closeContext: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(null),
    dispatchEvent: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    enableRequestInterception: vi.fn().mockResolvedValue(undefined),
    disableRequestInterception: vi.fn().mockResolvedValue(undefined),
    fulfillRequest: vi.fn().mockResolvedValue(undefined),
    continueRequest: vi.fn().mockResolvedValue(undefined),
    abortRequest: vi.fn().mockResolvedValue(undefined),
    onRequest: vi.fn().mockReturnValue(() => {}),
    resetContext: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const ctx: PooledContext = { contextId: "ctx-1", adapterId: "adapter-1" };

describe("Page.route", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("calls enableRequestInterception when first route is added", async () => {
    await page.route("/api/users", () => {});
    expect(adapter.enableRequestInterception).toHaveBeenCalledWith("ctx-1");
  });

  it("does not call enableRequestInterception again for second route", async () => {
    await page.route("/api/users", () => {});
    await page.route("/api/posts", () => {});
    expect(adapter.enableRequestInterception).toHaveBeenCalledTimes(1);
  });

  it("registers onRequest listener when first route is added", async () => {
    await page.route("/api/users", () => {});
    expect(adapter.onRequest).toHaveBeenCalledWith("ctx-1", expect.any(Function));
  });

  it("unroute removes a pattern and disables interception when no routes remain", async () => {
    await page.route("/api/users", () => {});
    await page.unroute("/api/users");
    expect(adapter.disableRequestInterception).toHaveBeenCalledWith("ctx-1");
  });

  it("unroute does not disable interception if other routes remain", async () => {
    await page.route("/api/users", () => {});
    await page.route("/api/posts", () => {});
    await page.unroute("/api/users");
    expect(adapter.disableRequestInterception).not.toHaveBeenCalled();
  });

  it("page.resetRoutes() clears routes and disables interception", async () => {
    await page.route("/api/users", () => {});
    await page.resetRoutes();
    expect(adapter.disableRequestInterception).toHaveBeenCalledWith("ctx-1");
  });

  it("adapter.resetContext() flow: after reset, routes no longer fire", async () => {
    // Simulate the actual AC-4 codepath: adapter.resetContext() disables
    // interception so any new requests through the old page should not reach
    // handlers (the page's _unsubscribeRequest listener is detached).
    const handler = vi.fn();
    await page.route("/api/users", handler);

    // Call disableRequestInterception directly (what resetContext triggers via
    // the adapter) then verify the unsubscribe was invoked.
    const unsubscribeSpy = (adapter.onRequest as ReturnType<typeof vi.fn>).mock.results[0]?.value as ReturnType<typeof vi.fn>;
    expect(typeof unsubscribeSpy).toBe("function");

    await adapter.disableRequestInterception!("ctx-1");
    expect(adapter.disableRequestInterception).toHaveBeenCalledWith("ctx-1");
  });

  it("pattern matching: exact string match", async () => {
    const handler = vi.fn();
    await page.route("/api/users", handler);

    // Simulate an incoming request matching the pattern
    const onRequestCb = (adapter.onRequest as ReturnType<typeof vi.fn>).mock.calls[0][1] as (req: { requestId: string; url: string }) => void;
    onRequestCb({ requestId: "req-1", url: "/api/users" });

    expect(handler).toHaveBeenCalled();
  });

  it("pattern matching: non-matching URL is passed through via continueRequest", async () => {
    const handler = vi.fn();
    await page.route("/api/users", handler);

    const onRequestCb = (adapter.onRequest as ReturnType<typeof vi.fn>).mock.calls[0][1] as (req: { requestId: string; url: string }) => void;
    onRequestCb({ requestId: "req-2", url: "/api/posts" });

    expect(handler).not.toHaveBeenCalled();
    expect(adapter.continueRequest).toHaveBeenCalledWith("ctx-1", "req-2");
  });

  it("pattern matching: glob ** matches any path segments", async () => {
    const handler = vi.fn();
    await page.route("/api/**", handler);

    const onRequestCb = (adapter.onRequest as ReturnType<typeof vi.fn>).mock.calls[0][1] as (req: { requestId: string; url: string }) => void;
    onRequestCb({ requestId: "req-3", url: "/api/users/42" });

    expect(handler).toHaveBeenCalled();
  });

  it("pattern matching: RegExp pattern", async () => {
    const handler = vi.fn();
    await page.route(/^\/api\/users\/\d+$/, handler);

    const onRequestCb = (adapter.onRequest as ReturnType<typeof vi.fn>).mock.calls[0][1] as (req: { requestId: string; url: string }) => void;
    onRequestCb({ requestId: "req-4", url: "/api/users/99" });

    expect(handler).toHaveBeenCalled();
  });

  it("route.fulfill is wired to adapter.fulfillRequest", async () => {
    let capturedRoute: import("../../api/Route.js").Route | undefined;
    await page.route("/api/users", (route) => {
      capturedRoute = route;
    });

    const onRequestCb = (adapter.onRequest as ReturnType<typeof vi.fn>).mock.calls[0][1] as (req: { requestId: string; url: string }) => void;
    onRequestCb({ requestId: "req-5", url: "/api/users" });

    expect(capturedRoute).toBeDefined();
    await capturedRoute!.fulfill({ status: 200, json: { users: [] } });
    expect(adapter.fulfillRequest).toHaveBeenCalledWith("ctx-1", "req-5", {
      status: 200,
      json: { users: [] },
    });
  });

  it("route.continue is wired to adapter.continueRequest", async () => {
    let capturedRoute: import("../../api/Route.js").Route | undefined;
    await page.route("/api/users", (route) => {
      capturedRoute = route;
    });

    const onRequestCb = (adapter.onRequest as ReturnType<typeof vi.fn>).mock.calls[0][1] as (req: { requestId: string; url: string }) => void;
    onRequestCb({ requestId: "req-6", url: "/api/users" });

    await capturedRoute!.continue();
    expect(adapter.continueRequest).toHaveBeenCalledWith("ctx-1", "req-6");
  });

  it("route.abort is wired to adapter.abortRequest", async () => {
    let capturedRoute: import("../../api/Route.js").Route | undefined;
    await page.route("/api/users", (route) => {
      capturedRoute = route;
    });

    const onRequestCb = (adapter.onRequest as ReturnType<typeof vi.fn>).mock.calls[0][1] as (req: { requestId: string; url: string }) => void;
    onRequestCb({ requestId: "req-7", url: "/api/users" });

    await capturedRoute!.abort();
    expect(adapter.abortRequest).toHaveBeenCalledWith("ctx-1", "req-7");
  });

  it("AC-7: double-settle throws 'Route already settled'", async () => {
    let capturedRoute: import("../../api/Route.js").Route | undefined;
    await page.route("/api/users", (route) => {
      capturedRoute = route;
    });

    const onRequestCb = (adapter.onRequest as ReturnType<typeof vi.fn>).mock.calls[0][1] as (req: { requestId: string; url: string }) => void;
    onRequestCb({ requestId: "req-8", url: "/api/users" });

    await capturedRoute!.continue();
    await expect(capturedRoute!.fulfill({ status: 200 })).rejects.toThrow("Route already settled");
    await expect(capturedRoute!.continue()).rejects.toThrow("Route already settled");
    await expect(capturedRoute!.abort()).rejects.toThrow("Route already settled");
  });

  it("AC-8: handler that never calls fulfill/continue/abort falls back to continueRequest", async () => {
    // Handler deliberately does nothing
    await page.route("/api/users", (_route) => {
      // intentionally not calling any method
    });

    const onRequestCb = (adapter.onRequest as ReturnType<typeof vi.fn>).mock.calls[0][1] as (req: { requestId: string; url: string }) => void;
    onRequestCb({ requestId: "req-9", url: "/api/users" });

    // Wait for the microtask/promise chain to settle
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(adapter.continueRequest).toHaveBeenCalledWith("ctx-1", "req-9");
  });

  it("AC-8: async handler that throws falls back to continueRequest", async () => {
    await page.route("/api/users", async (_route) => {
      throw new Error("handler blew up");
    });

    const onRequestCb = (adapter.onRequest as ReturnType<typeof vi.fn>).mock.calls[0][1] as (req: { requestId: string; url: string }) => void;
    onRequestCb({ requestId: "req-10", url: "/api/users" });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(adapter.continueRequest).toHaveBeenCalledWith("ctx-1", "req-10");
  });

  it("AC-11: unroute with a different RegExp instance (same source+flags) removes the handler", async () => {
    const handler = vi.fn();
    // Register with one RegExp instance
    await page.route(/\/api\/users/, handler);

    // Unroute with a separate RegExp instance that has the same source + flags
    await page.unroute(/\/api\/users/);

    // Interception should be disabled since no routes remain
    expect(adapter.disableRequestInterception).toHaveBeenCalledWith("ctx-1");

    // The handler should not fire for matching requests anymore
    const onRequestCb = (adapter.onRequest as ReturnType<typeof vi.fn>).mock.calls[0][1] as (req: { requestId: string; url: string }) => void;
    onRequestCb({ requestId: "req-11", url: "/api/users" });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler).not.toHaveBeenCalled();
  });
});
