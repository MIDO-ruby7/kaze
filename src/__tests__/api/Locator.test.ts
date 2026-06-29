/**
 * Unit tests for Locator (AC-2).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { Locator } from "../../api/Locator.js";
import { createPage, Page } from "../../api/Page.js";
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
    ...overrides,
  };
}

const ctx: PooledContext = { contextId: "ctx-1", adapterId: "adapter-1" };

describe("Locator", () => {
  let adapter: ProtocolAdapter;
  let page: Page;
  let locator: Locator;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
    locator = page.locator("#result");
  });

  it("click delegates to page.click", async () => {
    // waitForSelector resolves immediately, then dispatches click
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await locator.click();
    expect(adapter.dispatchEvent).toHaveBeenCalledWith("ctx-1", "#result", "click");
  });

  it("fill delegates to page.fill", async () => {
    // waitForSelector resolves first (true), then fill evaluate is called
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(undefined);
    await locator.fill("world");
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    // second call is the fill evaluate
    const expr = calls[1][1] as string;
    expect(expr).toContain("world");
  });

  it("textContent delegates to page.textContent", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true)   // waitForSelector poll - found
      .mockResolvedValueOnce("foo"); // textContent evaluate
    const text = await locator.textContent();
    expect(text).toBe("foo");
  });

  it("getSelector returns the selector", () => {
    expect(locator.getSelector()).toBe("#result");
  });

  it("getPage returns the page", () => {
    expect(locator.getPage()).toBe(page);
  });

  // AC-5: Locator methods propagate timeout option
  it("locator click retries until element is found", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await locator.click();
    expect(adapter.dispatchEvent).toHaveBeenCalledWith("ctx-1", "#result", "click");
  });

  it("locator fill retries until element is found", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await locator.fill("world");
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    const fillCall = calls.find((c: unknown[]) => (c[1] as string).includes("el.value"));
    expect(fillCall).toBeDefined();
  });

  it("locator textContent retries until element is found", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce("foo");

    const text = await locator.textContent();
    expect(text).toBe("foo");
  });

  it("locator click accepts timeout option", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await locator.click({ timeout: 5000 });
    expect(adapter.dispatchEvent).toHaveBeenCalledWith("ctx-1", "#result", "click");
  });

  it("locator fill accepts timeout option", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await locator.fill("world", { timeout: 5000 });
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    const fillCall = calls.find((c: unknown[]) => (c[1] as string).includes("world"));
    expect(fillCall).toBeDefined();
  });

  it("locator textContent accepts timeout option", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce("bar");
    const text = await locator.textContent({ timeout: 5000 });
    expect(text).toBe("bar");
  });
});
