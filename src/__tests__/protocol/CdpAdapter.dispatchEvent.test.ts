/**
 * AC-1, AC-2: Unit tests for CdpAdapter.dispatchEvent CDP click behavior.
 *
 * Verifies that:
 * - AC-1: click uses Input.dispatchMouseEvent (mousePressed + mouseReleased)
 * - AC-2: click coordinates come from getBoundingClientRect() element center
 * - Non-click events still use the legacy JS dispatchEvent path
 * - Error is thrown when element is not visible (zero-size bounding box)
 * - Error is thrown when element is out of viewport
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

import { CdpAdapter } from "../../protocol/CdpAdapter.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Build a minimal fake CdpPageSession with a controllable `send` mock.
 */
function makeFakeSession(sendMock: ReturnType<typeof vi.fn>) {
  return { send: sendMock } as unknown as object;
}

describe("AC-1, AC-2: CdpAdapter.dispatchEvent — CDP click path", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adapter: any;
  const contextId = "ctx-1";

  beforeEach(() => {
    adapter = new CdpAdapter({ executablePath: "/fake/chromium" });
  });

  it("AC-1: click sends mousePressed then mouseReleased via Input.dispatchMouseEvent", async () => {
    const sendMock = vi.fn();
    // First call: Runtime.evaluate to get bounding rect
    sendMock.mockResolvedValueOnce({
      result: {
        value: JSON.stringify({ left: 100, top: 200, width: 80, height: 40 }),
      },
    });
    // Second call: Input.dispatchMouseEvent mousePressed
    sendMock.mockResolvedValueOnce({});
    // Third call: Input.dispatchMouseEvent mouseReleased
    sendMock.mockResolvedValueOnce({});

    adapter.targetSessions.set(contextId, makeFakeSession(sendMock));

    await adapter.dispatchEvent(contextId, "#btn", "click");

    // Must have called Input.dispatchMouseEvent twice
    const cdpCalls = sendMock.mock.calls.map((c: unknown[]) => c[0]);
    expect(cdpCalls.filter((m: string) => m === "Input.dispatchMouseEvent")).toHaveLength(2);

    // First CDP mouse call is mousePressed
    const mousePressedCall = sendMock.mock.calls.find(
      (c: unknown[]) => c[0] === "Input.dispatchMouseEvent" && (c[1] as { type: string }).type === "mousePressed",
    );
    expect(mousePressedCall).toBeDefined();
    expect(mousePressedCall![1]).toMatchObject({
      type: "mousePressed",
      button: "left",
      clickCount: 1,
    });

    // Second CDP mouse call is mouseReleased
    const mouseReleasedCall = sendMock.mock.calls.find(
      (c: unknown[]) => c[0] === "Input.dispatchMouseEvent" && (c[1] as { type: string }).type === "mouseReleased",
    );
    expect(mouseReleasedCall).toBeDefined();
    expect(mouseReleasedCall![1]).toMatchObject({
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
    });
  });

  it("AC-2: click coordinates are the element center from getBoundingClientRect", async () => {
    const sendMock = vi.fn();
    // left=100, top=200, width=80, height=40 → center: x=140, y=220
    sendMock.mockResolvedValueOnce({
      result: {
        value: JSON.stringify({ left: 100, top: 200, width: 80, height: 40 }),
      },
    });
    sendMock.mockResolvedValueOnce({});
    sendMock.mockResolvedValueOnce({});

    adapter.targetSessions.set(contextId, makeFakeSession(sendMock));

    await adapter.dispatchEvent(contextId, "#btn", "click");

    const pressedCall = sendMock.mock.calls.find(
      (c: unknown[]) => c[0] === "Input.dispatchMouseEvent" && (c[1] as { type: string }).type === "mousePressed",
    );
    expect(pressedCall![1]).toMatchObject({ x: 140, y: 220 });

    const releasedCall = sendMock.mock.calls.find(
      (c: unknown[]) => c[0] === "Input.dispatchMouseEvent" && (c[1] as { type: string }).type === "mouseReleased",
    );
    expect(releasedCall![1]).toMatchObject({ x: 140, y: 220 });
  });

  it("non-click events still use JS dispatchEvent (not Input.dispatchMouseEvent)", async () => {
    const sendMock = vi.fn();
    // JS dispatchEvent via Runtime.evaluate — resolves with no exception
    sendMock.mockResolvedValueOnce({ result: { type: "undefined" } });

    adapter.targetSessions.set(contextId, makeFakeSession(sendMock));

    await adapter.dispatchEvent(contextId, "#btn", "mouseover");

    const cdpCalls = sendMock.mock.calls.map((c: unknown[]) => c[0]);
    expect(cdpCalls).not.toContain("Input.dispatchMouseEvent");
    expect(cdpCalls).toContain("Runtime.evaluate");
  });

  it("throws when element has zero-size bounding box (not visible)", async () => {
    const sendMock = vi.fn();
    sendMock.mockResolvedValueOnce({
      result: {
        value: JSON.stringify({ left: 0, top: 0, width: 0, height: 0 }),
      },
    });

    adapter.targetSessions.set(contextId, makeFakeSession(sendMock));

    await expect(adapter.dispatchEvent(contextId, "#hidden", "click")).rejects.toThrow(
      /not visible|zero.size|hidden/i,
    );
  });

  it("throws when element center is outside viewport (negative coordinates)", async () => {
    const sendMock = vi.fn();
    // Element far off-screen to the left
    sendMock.mockResolvedValueOnce({
      result: {
        value: JSON.stringify({ left: -500, top: -500, width: 10, height: 10 }),
      },
    });

    adapter.targetSessions.set(contextId, makeFakeSession(sendMock));

    await expect(adapter.dispatchEvent(contextId, "#offscreen", "click")).rejects.toThrow(
      /viewport|out.of.bounds|outside/i,
    );
  });
});
