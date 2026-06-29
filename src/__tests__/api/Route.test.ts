/**
 * Unit tests for Route (AC-5).
 * Tests route.fulfill / route.continue / route.abort logic.
 */

import { describe, it, expect, vi } from "vitest";

import { Route } from "../../api/Route.js";

function makeCallbacks() {
  return {
    onFulfill: vi.fn().mockResolvedValue(undefined),
    onContinue: vi.fn().mockResolvedValue(undefined),
    onAbort: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Route", () => {
  it("fulfill delegates to the fulfill callback with options", async () => {
    const { onFulfill, onContinue, onAbort } = makeCallbacks();
    const route = new Route("req-1", onFulfill, onContinue, onAbort);
    await route.fulfill({ status: 200, json: { ok: true } });
    expect(onFulfill).toHaveBeenCalledWith({ status: 200, json: { ok: true } });
    expect(onContinue).not.toHaveBeenCalled();
    expect(onAbort).not.toHaveBeenCalled();
  });

  it("continue delegates to the continue callback", async () => {
    const { onFulfill, onContinue, onAbort } = makeCallbacks();
    const route = new Route("req-1", onFulfill, onContinue, onAbort);
    await route.continue();
    expect(onContinue).toHaveBeenCalled();
    expect(onFulfill).not.toHaveBeenCalled();
    expect(onAbort).not.toHaveBeenCalled();
  });

  it("abort delegates to the abort callback", async () => {
    const { onFulfill, onContinue, onAbort } = makeCallbacks();
    const route = new Route("req-1", onFulfill, onContinue, onAbort);
    await route.abort();
    expect(onAbort).toHaveBeenCalled();
    expect(onFulfill).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("exposes requestId", () => {
    const cbs = makeCallbacks();
    const route = new Route("req-42", cbs.onFulfill, cbs.onContinue, cbs.onAbort);
    expect(route.requestId).toBe("req-42");
  });
});
