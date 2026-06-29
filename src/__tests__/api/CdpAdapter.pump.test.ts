/**
 * AC-13: Unit tests for CdpAdapter._startRequestPausedLoop pump loop behavior.
 *
 * Verifies that:
 * - A timeout exception ("Timeout waiting for...") causes the loop to continue
 *   and call waitForEvent again.
 * - A session-closed exception ("CdpSession is already closed") causes the loop
 *   to break and stop calling waitForEvent.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import { CdpAdapter } from "../../protocol/CdpAdapter.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Build a minimal fake CdpPageSession duck-typed to what _startRequestPausedLoop
 * uses: just a `waitForEvent` method.
 */
function makeFakeSession(waitForEvent: ReturnType<typeof vi.fn>) {
  return { waitForEvent } as unknown as Parameters<
    // Access the private method via bracket notation after casting to any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adapter: any) => void
  >[0];
}

describe("AC-13: CdpAdapter pump loop", () => {
  it("continues (calls waitForEvent again) on timeout, stops on session close", async () => {
    // Create adapter with a fake executable path so the constructor does not
    // attempt to probe the filesystem.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = new CdpAdapter({ executablePath: "/fake/chromium" }) as any;

    const contextId = "ctx-test";

    // Simulate the internal state that enableRequestInterception would set up.
    adapter.interceptionEnabled = new Map([[contextId, true]]);
    adapter.requestListeners = new Map([[contextId, new Set()]]);
    adapter.pendingPausedRequests = new Map([[contextId, new Set()]]);

    // waitForEvent call sequence:
    //   1st call  → throws timeout error  (loop should continue → 2nd call)
    //   2nd call  → throws session-close error (loop should break → no 3rd call)
    const waitForEvent = vi.fn()
      .mockRejectedValueOnce(
        new Error("Timeout waiting for CDP event \"Fetch.requestPaused\" in session s1 after 60000ms"),
      )
      .mockRejectedValueOnce(
        new Error("CdpSession is already closed"),
      );

    const fakeSession = { waitForEvent } as unknown as object;

    // Start the pump loop (private method accessed via any).
    adapter._startRequestPausedLoop(contextId, fakeSession);

    // Allow the async pump to run to completion.
    // Two rejected promises need two microtask flushes.
    await new Promise<void>((r) => setTimeout(r, 20));

    // The loop should have called waitForEvent exactly twice:
    //   - 1st call: received timeout → continued
    //   - 2nd call: received session close → broke out
    expect(waitForEvent).toHaveBeenCalledTimes(2);
  });

  it("keeps looping as long as timeout errors occur and interception is enabled", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = new CdpAdapter({ executablePath: "/fake/chromium" }) as any;

    const contextId = "ctx-test-2";
    adapter.interceptionEnabled = new Map([[contextId, true]]);
    adapter.requestListeners = new Map([[contextId, new Set()]]);
    adapter.pendingPausedRequests = new Map([[contextId, new Set()]]);

    // Three timeout errors then a session-close — expects 4 total calls.
    const waitForEvent = vi.fn()
      .mockRejectedValueOnce(new Error("Timeout waiting for CDP event in session"))
      .mockRejectedValueOnce(new Error("Timeout waiting for CDP event in session"))
      .mockRejectedValueOnce(new Error("Timeout waiting for CDP event in session"))
      .mockRejectedValueOnce(new Error("CdpSession is already closed"));

    const fakeSession = { waitForEvent } as unknown as object;
    adapter._startRequestPausedLoop(contextId, fakeSession);

    await new Promise<void>((r) => setTimeout(r, 30));

    expect(waitForEvent).toHaveBeenCalledTimes(4);
  });

  it("stops immediately when interception is disabled between iterations", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = new CdpAdapter({ executablePath: "/fake/chromium" }) as any;

    const contextId = "ctx-test-3";
    adapter.interceptionEnabled = new Map([[contextId, true]]);
    adapter.requestListeners = new Map([[contextId, new Set()]]);
    adapter.pendingPausedRequests = new Map([[contextId, new Set()]]);

    // The first timeout removes interception so the while-condition fails on
    // the next iteration — waitForEvent should not be called a second time.
    const waitForEvent = vi.fn().mockImplementation(() => {
      // Remove the contextId from interceptionEnabled to simulate disabling
      adapter.interceptionEnabled.delete(contextId);
      return Promise.reject(
        new Error("Timeout waiting for CDP event in session"),
      );
    });

    const fakeSession = { waitForEvent } as unknown as object;
    adapter._startRequestPausedLoop(contextId, fakeSession);

    await new Promise<void>((r) => setTimeout(r, 20));

    // Called exactly once: after the timeout the while-condition is false,
    // so the loop exits without a second call.
    expect(waitForEvent).toHaveBeenCalledTimes(1);
  });
});
