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
    await locator.click();
    expect(adapter.dispatchEvent).toHaveBeenCalledWith("ctx-1", "#result", "click");
  });

  it("fill delegates to page.fill", async () => {
    await locator.fill("world");
    expect(adapter.evaluate).toHaveBeenCalledTimes(1);
    const expr = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(expr).toContain("world");
  });

  it("textContent delegates to page.textContent", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue("foo");
    const text = await locator.textContent();
    expect(text).toBe("foo");
  });

  it("getSelector returns the selector", () => {
    expect(locator.getSelector()).toBe("#result");
  });

  it("getPage returns the page", () => {
    expect(locator.getPage()).toBe(page);
  });
});
