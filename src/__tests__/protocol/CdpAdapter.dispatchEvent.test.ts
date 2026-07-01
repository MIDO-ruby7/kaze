/**
 * AC-1, AC-2: Unit tests for CdpAdapter.dispatchEvent CDP click behavior.
 *
 * Verifies that:
 * - AC-1: click uses Input.dispatchMouseEvent (mouseMoved + mousePressed + mouseReleased)
 * - AC-2: click coordinates come from getBoundingClientRect() element center
 * - B-1: querySelector null returns null (not a crash) and throws a clear error
 * - B-2: odd-width elements produce Math.round coordinates
 * - B-3: element outside viewport triggers scrollIntoView then clicks
 * - Non-click events still use the legacy JS dispatchEvent path
 * - Error is thrown when element is not visible (zero-size bounding box)
 * - Error is thrown when element is still outside viewport after scroll
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

  it("AC-1: click sends mouseMoved, mousePressed, then mouseReleased via Input.dispatchMouseEvent", async () => {
    const sendMock = vi.fn();
    // First call: combined Runtime.evaluate (rect + viewport)
    sendMock.mockResolvedValueOnce({
      result: {
        value: JSON.stringify({ left: 100, top: 200, w: 80, h: 40, vw: 1280, vh: 720 }),
      },
    });
    // Second call: Input.dispatchMouseEvent mouseMoved
    sendMock.mockResolvedValueOnce({});
    // Third call: Input.dispatchMouseEvent mousePressed
    sendMock.mockResolvedValueOnce({});
    // Fourth call: Input.dispatchMouseEvent mouseReleased
    sendMock.mockResolvedValueOnce({});

    adapter.targetSessions.set(contextId, makeFakeSession(sendMock));

    await adapter.dispatchEvent(contextId, "#btn", "click");

    // Must have called Input.dispatchMouseEvent three times (mouseMoved + mousePressed + mouseReleased)
    const cdpCalls = sendMock.mock.calls.map((c: unknown[]) => c[0]);
    expect(cdpCalls.filter((m: string) => m === "Input.dispatchMouseEvent")).toHaveLength(3);

    // First CDP mouse call is mouseMoved
    const mouseMovedCall = sendMock.mock.calls.find(
      (c: unknown[]) => c[0] === "Input.dispatchMouseEvent" && (c[1] as { type: string }).type === "mouseMoved",
    );
    expect(mouseMovedCall).toBeDefined();
    expect(mouseMovedCall![1]).toMatchObject({
      type: "mouseMoved",
      button: "none",
      clickCount: 0,
    });

    // Second CDP mouse call is mousePressed
    const mousePressedCall = sendMock.mock.calls.find(
      (c: unknown[]) => c[0] === "Input.dispatchMouseEvent" && (c[1] as { type: string }).type === "mousePressed",
    );
    expect(mousePressedCall).toBeDefined();
    expect(mousePressedCall![1]).toMatchObject({
      type: "mousePressed",
      button: "left",
      clickCount: 1,
    });

    // Third CDP mouse call is mouseReleased
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
    // left=100, top=200, w=80, h=40 → center: x=140, y=220
    sendMock.mockResolvedValueOnce({
      result: {
        value: JSON.stringify({ left: 100, top: 200, w: 80, h: 40, vw: 1280, vh: 720 }),
      },
    });
    sendMock.mockResolvedValueOnce({}); // mouseMoved
    sendMock.mockResolvedValueOnce({}); // mousePressed
    sendMock.mockResolvedValueOnce({}); // mouseReleased

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
        value: JSON.stringify({ left: 0, top: 0, w: 0, h: 0, vw: 1280, vh: 720 }),
      },
    });

    adapter.targetSessions.set(contextId, makeFakeSession(sendMock));

    await expect(adapter.dispatchEvent(contextId, "#hidden", "click")).rejects.toThrow(
      /not visible|zero.size|hidden/i,
    );
  });

  it("B-1: throws a clear error when querySelector returns null", async () => {
    const sendMock = vi.fn();
    // B-1: evaluate returns null (element not found)
    sendMock.mockResolvedValueOnce({
      result: { value: null },
    });

    adapter.targetSessions.set(contextId, makeFakeSession(sendMock));

    await expect(adapter.dispatchEvent(contextId, "#missing", "click")).rejects.toThrow(
      /Element not found for click/,
    );
  });

  it("B-2: odd-width element produces Math.round coordinates", async () => {
    const sendMock = vi.fn();
    // left=10, top=10, w=81, h=40 → raw center: x=50.5, y=30 → rounded: x=51, y=30
    sendMock.mockResolvedValueOnce({
      result: {
        value: JSON.stringify({ left: 10, top: 10, w: 81, h: 40, vw: 1280, vh: 720 }),
      },
    });
    sendMock.mockResolvedValueOnce({}); // mouseMoved
    sendMock.mockResolvedValueOnce({}); // mousePressed
    sendMock.mockResolvedValueOnce({}); // mouseReleased

    adapter.targetSessions.set(contextId, makeFakeSession(sendMock));

    await adapter.dispatchEvent(contextId, "#odd", "click");

    const pressedCall = sendMock.mock.calls.find(
      (c: unknown[]) => c[0] === "Input.dispatchMouseEvent" && (c[1] as { type: string }).type === "mousePressed",
    );
    // x = Math.round(10 + 81/2) = Math.round(50.5) = 51
    expect(pressedCall![1]).toMatchObject({ x: 51, y: 30 });
  });

  it("B-3: viewport 外要素は scrollIntoView 後にクリックされる", async () => {
    const sendMock = vi.fn();
    // 初回 combined evaluate: 要素が viewport 外 (x=-495 < 0)
    sendMock.mockResolvedValueOnce({
      result: {
        value: JSON.stringify({ left: -500, top: 100, w: 10, h: 10, vw: 1280, vh: 720 }),
      },
    });
    // scrollIntoView の Runtime.evaluate
    sendMock.mockResolvedValueOnce({ result: { value: null } });
    // スクロール後の combined evaluate: 要素が viewport 内
    sendMock.mockResolvedValueOnce({
      result: {
        value: JSON.stringify({ left: 100, top: 200, w: 10, h: 10, vw: 1280, vh: 720 }),
      },
    });
    // Input.dispatchMouseEvent mouseMoved
    sendMock.mockResolvedValueOnce({});
    // Input.dispatchMouseEvent mousePressed
    sendMock.mockResolvedValueOnce({});
    // Input.dispatchMouseEvent mouseReleased
    sendMock.mockResolvedValueOnce({});

    adapter.targetSessions.set(contextId, makeFakeSession(sendMock));

    await adapter.dispatchEvent(contextId, "#offscreen", "click");

    // scrollIntoView が呼ばれたことを確認
    const scrollCall = sendMock.mock.calls.find(
      (c: unknown[]) =>
        c[0] === "Runtime.evaluate" &&
        typeof (c[1] as { expression: string }).expression === "string" &&
        (c[1] as { expression: string }).expression.includes("scrollIntoView"),
    );
    expect(scrollCall).toBeDefined();

    // スクロール後の座標でクリックされることを確認: x=105, y=205
    const pressedCall = sendMock.mock.calls.find(
      (c: unknown[]) => c[0] === "Input.dispatchMouseEvent" && (c[1] as { type: string }).type === "mousePressed",
    );
    expect(pressedCall![1]).toMatchObject({ x: 105, y: 205 });
  });

  it("throws when element is still outside viewport after scrollIntoView", async () => {
    const sendMock = vi.fn();
    // 初回 combined evaluate: 要素が viewport 外
    sendMock.mockResolvedValueOnce({
      result: {
        value: JSON.stringify({ left: -500, top: -500, w: 10, h: 10, vw: 1280, vh: 720 }),
      },
    });
    // scrollIntoView の Runtime.evaluate
    sendMock.mockResolvedValueOnce({ result: { value: null } });
    // ポーリング中のすべての combined evaluate: ずっと viewport 外
    // (ポーリングは最大500ms・50msごとなので複数回呼ばれる可能性があるためデフォルト値を設定)
    sendMock.mockResolvedValue({
      result: {
        value: JSON.stringify({ left: -500, top: -500, w: 10, h: 10, vw: 1280, vh: 720 }),
      },
    });

    adapter.targetSessions.set(contextId, makeFakeSession(sendMock));

    await expect(adapter.dispatchEvent(contextId, "#stuck", "click")).rejects.toThrow(
      /still outside viewport after scroll/i,
    );
  });
});
