/**
 * Unit tests for Page (AC-1).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { Locator } from "../../api/Locator.js";
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
    ...overrides,
  };
}

const ctx: PooledContext = { contextId: "ctx-1", adapterId: "adapter-1" };

describe("Page", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("goto delegates to adapter.navigate", async () => {
    await page.goto("https://example.com");
    expect(adapter.navigate).toHaveBeenCalledWith("ctx-1", "https://example.com");
  });

  it("click delegates to adapter.dispatchEvent with 'click'", async () => {
    // waitForSelector resolves immediately (element found), then dispatches
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await page.click("#btn");
    expect(adapter.dispatchEvent).toHaveBeenCalledWith("ctx-1", "#btn", "click");
  });

  it("fill evaluates JS to set value and dispatch events", async () => {
    // waitForSelector resolves first (true), then fill evaluate is called
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true)   // waitForSelector poll - found
      .mockResolvedValueOnce(undefined); // fill evaluate
    await page.fill("#input", "hello");
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    // second call is the fill evaluate (index 1)
    const expr = calls[1][1] as string;
    expect(expr).toContain("el.value");
    expect(expr).toContain("hello");
  });

  it("textContent returns string from evaluate", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true)          // waitForSelector poll - found
      .mockResolvedValueOnce("Hello World"); // textContent evaluate
    const text = await page.textContent("#heading");
    expect(text).toBe("Hello World");
  });

  it("textContent returns null when element not found (returns null text)", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true)  // waitForSelector poll - found
      .mockResolvedValueOnce(null); // textContent evaluate returns null
    const text = await page.textContent("#missing");
    expect(text).toBeNull();
  });

  it("close delegates to adapter.closeContext", async () => {
    await page.close();
    expect(adapter.closeContext).toHaveBeenCalledWith("ctx-1");
  });

  it("locator returns a Locator for the selector", () => {
    const loc = page.locator("#result");
    expect(loc).toBeInstanceOf(Locator);
    expect(loc.selector).toBe("#result");
  });

  it("waitForSelector resolves when element is found", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(page.waitForSelector("#el", { timeout: 1000 })).resolves.toBeUndefined();
  });

  it("waitForSelector rejects on timeout", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await expect(page.waitForSelector("#el", { timeout: 150 })).rejects.toThrow(
      /Timeout \d+ms waiting for selector/,
    );
  });

  // AC-6: timeout error message contains selector and timeout value
  it("waitForSelector error message contains selector and timeout ms", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await expect(page.waitForSelector("#submit", { timeout: 300 })).rejects.toThrow(
      'Timeout 300ms waiting for selector "#submit"',
    );
  });

  // AC-1: click waits for element before dispatching
  it("click retries until element is found, then dispatches", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await page.click("#btn");
    expect(adapter.dispatchEvent).toHaveBeenCalledWith("ctx-1", "#btn", "click");
  });

  it("click throws timeout error when element never appears", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await expect(page.click("#btn", { timeout: 200 })).rejects.toThrow(
      'Timeout 200ms waiting for selector "#btn"',
    );
  });

  // AC-2: fill waits for element before filling
  it("fill retries until element is found, then fills", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await page.fill("#input", "hello");
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    // first call is waitForSelector polling, subsequent calls are the fill logic
    const fillCall = calls.find((c: unknown[]) => (c[1] as string).includes("el.value"));
    expect(fillCall).toBeDefined();
  });

  it("fill throws timeout error when element never appears", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await expect(page.fill("#input", "value", { timeout: 200 })).rejects.toThrow(
      'Timeout 200ms waiting for selector "#input"',
    );
  });

  // AC-3: textContent waits for element
  it("textContent retries until element is found, then returns text", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false)  // waitForSelector first poll
      .mockResolvedValueOnce(true)   // waitForSelector second poll - found
      .mockResolvedValueOnce("Hello World"); // textContent evaluate

    const text = await page.textContent("#heading");
    expect(text).toBe("Hello World");
  });

  it("textContent throws timeout error when element never appears", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await expect(page.textContent("#heading", { timeout: 200 })).rejects.toThrow(
      'Timeout 200ms waiting for selector "#heading"',
    );
  });

  // AC-7: individual timeout option
  it("click accepts { timeout } option", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await page.click("#slow-btn", { timeout: 5000 });
    expect(adapter.dispatchEvent).toHaveBeenCalledWith("ctx-1", "#slow-btn", "click");
  });

  it("url() evaluates window.location.href", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue("https://example.com/");
    const url = await page.url();
    expect(url).toBe("https://example.com/");
  });

  it("contextId is exposed", () => {
    expect(page.contextId).toBe("ctx-1");
  });

  describe("selector escaping (B-1)", () => {
    it("fill escapes attribute selector with single quotes", async () => {
      // waitForSelector uses evaluate first (returns true), then fill evaluate
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(undefined);
      await page.fill("[data-id='123']", "hello");
      const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
      // Second call (index 1) is the fill evaluate with the escaped selector
      const expr = calls[1][1] as string;
      // The selector single-quote must be escaped to \' in the JS string
      expect(expr).toContain("[data-id=\\'123\\']");
    });

    it("textContent escapes attribute selector with single quotes", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue("result");
      await page.textContent("[data-id='123']");
      const expr = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(expr).toContain("[data-id=\\'123\\']");
    });

    it("waitForSelector escapes attribute selector with single quotes", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      await page.waitForSelector("[data-id='123']");
      const expr = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(expr).toContain("[data-id=\\'123\\']");
    });
  });
});
