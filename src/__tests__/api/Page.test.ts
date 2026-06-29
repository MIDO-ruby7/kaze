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

  // -------------------------------------------------------------------------
  // AC-10: detached element — retry waitForSelector→action on "Element not found"
  // -------------------------------------------------------------------------
  describe("AC-10: detached element retry", () => {
    it("click retries after 'Element not found' from dispatchEvent", async () => {
      // waitForSelector finds the element on the first poll, but dispatchEvent
      // throws "Element not found" once (element detached mid-flight), then
      // on the second iteration waitForSelector finds it again and click succeeds.
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)   // 1st waitForSelector: found
        .mockResolvedValueOnce(true);  // 2nd waitForSelector (after retry): found
      (adapter.dispatchEvent as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error("Element not found: #btn"))
        .mockResolvedValueOnce(undefined);

      await page.click("#btn", { timeout: 2000 });
      expect(adapter.dispatchEvent).toHaveBeenCalledTimes(2);
    });

    it("click propagates non-element-not-found errors immediately", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (adapter.dispatchEvent as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error("Network error"));

      await expect(page.click("#btn", { timeout: 2000 })).rejects.toThrow("Network error");
      expect(adapter.dispatchEvent).toHaveBeenCalledTimes(1);
    });

    it("fill retries after 'Element not found' from evaluate", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)   // 1st waitForSelector: found
        .mockRejectedValueOnce(new Error("Element not found: #input")) // fill evaluate fails
        .mockResolvedValueOnce(true)   // 2nd waitForSelector: found
        .mockResolvedValueOnce(undefined); // fill evaluate succeeds

      await page.fill("#input", "hello", { timeout: 2000 });
      // evaluate called 4 times: wfs-1, fill-fail, wfs-2, fill-ok
      expect((adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
    });

    it("fill propagates non-element-not-found errors immediately", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)   // waitForSelector: found
        .mockRejectedValueOnce(new Error("JS execution error")); // fill throws

      await expect(page.fill("#input", "val", { timeout: 2000 })).rejects.toThrow(
        "JS execution error",
      );
    });
  });

  // -------------------------------------------------------------------------
  // AC-11: cancel() stops waitForSelector polling
  // -------------------------------------------------------------------------
  describe("AC-11: page cancellation", () => {
    it("cancel() sets _cancelled to true", () => {
      expect(page._cancelled).toBe(false);
      page.cancel();
      expect(page._cancelled).toBe(true);
    });

    it("close() sets _cancelled to true before closing context", async () => {
      await page.close();
      expect(page._cancelled).toBe(true);
      expect(adapter.closeContext).toHaveBeenCalledWith("ctx-1");
    });

    it("waitForSelector throws cancellation error when page is cancelled mid-poll", async () => {
      // Simulate: element never appears, but page is cancelled after first poll.
      let pollCount = 0;
      (adapter.evaluate as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        pollCount++;
        if (pollCount === 1) {
          // Cancel the page after the first evaluate returns false
          page.cancel();
        }
        return false;
      });

      await expect(page.waitForSelector("#el", { timeout: 5000 })).rejects.toThrow(
        /cancelled/,
      );
      // Should have stopped after the cancel, not run until 5000ms timeout
      expect(pollCount).toBe(1);
    });

    it("ctx._cancel is registered when Page is created", () => {
      const localCtx: import("../../pool/types.js").PooledContext = {
        contextId: "ctx-x",
        adapterId: "a-x",
      };
      const localPage = createPage(adapter, localCtx);
      expect(typeof localCtx._cancel).toBe("function");
      localCtx._cancel!();
      expect(localPage._cancelled).toBe(true);
    });

    it("ctx._cancel is removed after cancel() is called", () => {
      const localCtx: import("../../pool/types.js").PooledContext = {
        contextId: "ctx-y",
        adapterId: "a-y",
      };
      createPage(adapter, localCtx);
      expect(localCtx._cancel).toBeDefined();
      localCtx._cancel!();
      expect(localCtx._cancel).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // B-1: timeout:0 — loop never executes, must throw immediately
  // -------------------------------------------------------------------------
  describe("B-1: timeout:0 throws immediately", () => {
    it("click throws timeout error immediately when timeout is 0", async () => {
      await expect(page.click("#btn", { timeout: 0 })).rejects.toThrow(
        /Timeout 0ms waiting for selector/,
      );
      // adapter should never be called
      expect(adapter.evaluate).not.toHaveBeenCalled();
      expect(adapter.dispatchEvent).not.toHaveBeenCalled();
    });

    it("fill throws timeout error immediately when timeout is 0", async () => {
      await expect(page.fill("#input", "hello", { timeout: 0 })).rejects.toThrow(
        /Timeout 0ms waiting for selector/,
      );
      expect(adapter.evaluate).not.toHaveBeenCalled();
    });
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
