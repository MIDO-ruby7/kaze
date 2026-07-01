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

  // -------------------------------------------------------------------------
  // AC-1: count()
  // -------------------------------------------------------------------------
  describe("count()", () => {
    it("returns the number of matching elements", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(3);
      const n = await locator.count();
      expect(n).toBe(3);
    });

    it("returns 0 when no elements match", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0);
      const n = await locator.count();
      expect(n).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // AC-1: all()
  // -------------------------------------------------------------------------
  describe("all()", () => {
    it("returns an array of Locators using data-kaze-idx selectors", async () => {
      // First evaluate: count() → 2
      // Second evaluate: attribute assignment (returns undefined)
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(undefined);
      const locators = await locator.all();
      expect(locators).toHaveLength(2);
      expect(locators[0]).toBeInstanceOf(Locator);
      expect(locators[1]).toBeInstanceOf(Locator);
      // Each Locator should use data-kaze-idx attribute to target the correct element
      expect(locators[0].selector).toBe('[data-kaze-idx="0"]');
      expect(locators[1].selector).toBe('[data-kaze-idx="1"]');
    });

    it("passes a script that assigns data-kaze-idx attributes", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(undefined);
      await locator.all();
      const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
      const attrScript = calls[1][1] as string;
      expect(attrScript).toContain("data-kaze-idx");
      expect(attrScript).toContain("querySelectorAll");
    });

    it("returns empty array when count is 0", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0);
      const locators = await locator.all();
      expect(locators).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // AC-1: check() / uncheck()
  // -------------------------------------------------------------------------
  describe("check()", () => {
    it("waits for element and sets checked = true", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)      // waitForSelector
        .mockResolvedValueOnce(undefined); // check evaluate
      await locator.check();
      const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
      const expr = calls[1][1] as string;
      expect(expr).toContain("checked = true");
    });

    it("accepts timeout option", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(undefined);
      await locator.check({ timeout: 5000 });
      expect(adapter.evaluate).toHaveBeenCalledTimes(2);
    });
  });

  describe("uncheck()", () => {
    it("waits for element and sets checked = false", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(undefined);
      await locator.uncheck();
      const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
      const expr = calls[1][1] as string;
      expect(expr).toContain("checked = false");
    });
  });

  // -------------------------------------------------------------------------
  // AC-1: selectOption()
  // -------------------------------------------------------------------------
  describe("selectOption()", () => {
    it("selects by value string", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(undefined);
      await locator.selectOption("apple");
      const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
      const expr = calls[1][1] as string;
      expect(expr).toContain("apple");
    });

    it("selects by index (number)", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(undefined);
      await locator.selectOption(2);
      const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
      const expr = calls[1][1] as string;
      expect(expr).toContain("selectedIndex");
    });

    it("selects by label object", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(undefined);
      await locator.selectOption({ label: "Apple" });
      const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
      const expr = calls[1][1] as string;
      expect(expr).toContain("Apple");
    });

    // AC-8: non-existent option throws
    it("throws when option value does not exist (string)", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('Option not found for selector "#result" with value "nonexistent"'));
      await expect(locator.selectOption("nonexistent")).rejects.toThrow("Option not found");
    });

    it("generated script throws when option not found by value", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(undefined);
      await locator.selectOption("apple");
      const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
      const expr = calls[1][1] as string;
      // Script must contain a throw for the not-found case
      expect(expr).toContain("throw new Error");
    });
  });

  // -------------------------------------------------------------------------
  // AC-1: hover()
  // -------------------------------------------------------------------------
  describe("hover()", () => {
    it("waits for element and dispatches mouseover", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      await locator.hover();
      expect(adapter.dispatchEvent).toHaveBeenCalledWith("ctx-1", "#result", "mouseover");
    });

    it("accepts timeout option", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      await locator.hover({ timeout: 5000 });
      expect(adapter.dispatchEvent).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // AC-1: isVisible() — no auto-waiting
  // -------------------------------------------------------------------------
  describe("isVisible()", () => {
    it("returns true when element is visible", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      const result = await locator.isVisible();
      expect(result).toBe(true);
    });

    it("returns false when element is not visible", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
      const result = await locator.isVisible();
      expect(result).toBe(false);
    });

    it("does NOT call waitForSelector (no auto-waiting)", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
      await locator.isVisible();
      // Only one evaluate call (the visibility check itself), no waitForSelector loop
      expect(adapter.evaluate).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // AC-1: isEnabled() — no auto-waiting
  // -------------------------------------------------------------------------
  describe("isEnabled()", () => {
    it("returns true when element is enabled", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      const result = await locator.isEnabled();
      expect(result).toBe(true);
    });

    it("returns false when element is disabled", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
      const result = await locator.isEnabled();
      expect(result).toBe(false);
    });

    it("does NOT call waitForSelector (no auto-waiting)", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      await locator.isEnabled();
      expect(adapter.evaluate).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // AC-1 (Issue #36): getAttribute()
  // -------------------------------------------------------------------------
  describe("getAttribute()", () => {
    it("returns the attribute value when attribute exists", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)       // waitForSelector
        .mockResolvedValueOnce("en");      // getAttribute evaluate
      const value = await locator.getAttribute("lang");
      expect(value).toBe("en");
    });

    it("returns null when attribute is absent", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(null);
      const value = await locator.getAttribute("data-nonexistent");
      expect(value).toBeNull();
    });

    it("passes the attribute name into the evaluate expression", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce("primary");
      await locator.getAttribute("data-type");
      const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
      const expr = calls[1][1] as string;
      expect(expr).toContain("getAttribute");
      expect(expr).toContain("data-type");
    });

    it("accepts timeout option", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce("value");
      const result = await locator.getAttribute("href", { timeout: 5000 });
      expect(result).toBe("value");
    });
  });

  // -------------------------------------------------------------------------
  // AC-2 (Issue #36): innerText()
  // -------------------------------------------------------------------------
  describe("innerText()", () => {
    it("returns the visible text of the element", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)        // waitForSelector
        .mockResolvedValueOnce("Hello");    // innerText evaluate
      const text = await locator.innerText();
      expect(text).toBe("Hello");
    });

    it("returns empty string when innerText is empty", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce("");
      const text = await locator.innerText();
      expect(text).toBe("");
    });

    it("passes an innerText expression to evaluate", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce("text");
      await locator.innerText();
      const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
      const expr = calls[1][1] as string;
      expect(expr).toContain("innerText");
    });

    it("accepts timeout option", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce("content");
      const text = await locator.innerText({ timeout: 5000 });
      expect(text).toBe("content");
    });
  });

  // -------------------------------------------------------------------------
  // AC-1: inputValue()
  // -------------------------------------------------------------------------
  describe("inputValue()", () => {
    it("returns the current value of an input", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)       // waitForSelector
        .mockResolvedValueOnce("hello");   // inputValue evaluate
      const value = await locator.inputValue();
      expect(value).toBe("hello");
    });

    it("returns empty string when input is empty", async () => {
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce("");
      const value = await locator.inputValue();
      expect(value).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // Issue #46: comma-selector + first() / nth()
  // -------------------------------------------------------------------------
  describe("NthLocator with comma selector (Issue #46)", () => {
    it("first() uses a unique tag with timestamp+random suffix (AC-3)", async () => {
      const commaLocator = page.locator("h1, h2");
      // _resolveNth calls evaluate once (to tag the element), then textContent
      // calls waitForSelector (evaluate once) and innerText evaluate.
      // For this test we just check the attribute name format.
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(undefined)  // _resolveNth setAttribute
        .mockResolvedValueOnce(true)       // waitForSelector inside textContent
        .mockResolvedValueOnce("heading"); // textContent result
      const first = commaLocator.first();
      const text = await first.textContent();
      expect(text).toBe("heading");
      // The _resolveNth evaluate call must include a tag matching data-kaze-nth-<digits>-<alphanum>
      const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
      const resolveScript = calls[0][1] as string;
      expect(resolveScript).toMatch(/data-kaze-nth-\d+-[a-z0-9]+/);
    });

    it("_resolveNth does NOT escape the comma in the parent selector (AC-4)", async () => {
      const commaLocator = page.locator("h1, h2");
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(undefined);
      // Call internal resolve by triggering textContent (which calls _withResolved)
      // We inspect the evaluate call and make sure the raw selector passes through.
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce("h1 text");
      const text = await commaLocator.first().textContent();
      expect(text).toBe("h1 text");
      const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
      const resolveScript = calls[0][1] as string;
      // Comma must be present (not escaped as \,)
      expect(resolveScript).toContain("h1, h2");
      expect(resolveScript).not.toContain("h1\\,");
    });

    it("nth(1) tags the second element (AC-2)", async () => {
      const commaLocator = page.locator("h1, h2");
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(undefined)  // _resolveNth
        .mockResolvedValueOnce(true)       // waitForSelector
        .mockResolvedValueOnce("second");  // textContent
      const text = await commaLocator.nth(1).textContent();
      expect(text).toBe("second");
      const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
      const resolveScript = calls[0][1] as string;
      // Must use index 1
      expect(resolveScript).toContain("els[1]");
    });

    it("first() tags the first element with index 0 (AC-1)", async () => {
      const commaLocator = page.locator("h1, h2");
      (adapter.evaluate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce("first heading");
      const text = await commaLocator.first().textContent();
      expect(text).toBe("first heading");
      const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
      const resolveScript = calls[0][1] as string;
      expect(resolveScript).toContain("els[0]");
    });
  });
});
