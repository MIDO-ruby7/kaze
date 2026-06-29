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
    await page.click("#btn");
    expect(adapter.dispatchEvent).toHaveBeenCalledWith("ctx-1", "#btn", "click");
  });

  it("fill evaluates JS to set value and dispatch events", async () => {
    await page.fill("#input", "hello");
    expect(adapter.evaluate).toHaveBeenCalledTimes(1);
    const expr = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(expr).toContain("el.value");
    expect(expr).toContain("hello");
  });

  it("textContent returns string from evaluate", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue("Hello World");
    const text = await page.textContent("#heading");
    expect(text).toBe("Hello World");
  });

  it("textContent returns null when element not found", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
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
      /Timeout waiting for selector/,
    );
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
      await page.fill("[data-id='123']", "hello");
      const expr = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
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
