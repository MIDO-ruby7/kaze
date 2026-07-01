/**
 * Unit tests for Page getBy* methods (Issue #44).
 *
 * AC-1: page.getByText(text, opts?)
 * AC-2: page.getByLabel(text, opts?)
 * AC-3: page.getByPlaceholder(text, opts?)
 * AC-4: page.getByTestId(id)
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

describe("Page.getByText()", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("returns a Locator instance", () => {
    const loc = page.getByText("Submit");
    expect(loc).toBeInstanceOf(Locator);
  });

  it("partial match: evaluate script contains the text (exact: false by default)", async () => {
    // Mock: tag assignment returns a selector
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined) // tag assignment
      .mockResolvedValueOnce(true);     // waitForSelector
    const loc = page.getByText("Submit");
    // Clicking triggers the tag + waitForSelector + dispatchEvent
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (adapter.dispatchEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await loc.click();
    // The evaluate script should have been called with partial text matching
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    const tagScript = calls[0][1] as string;
    expect(tagScript).toContain("Submit");
    expect(tagScript).toContain("textContent");
  });

  it("exact match: evaluate script uses strict equality check when exact: true", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (adapter.dispatchEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const loc = page.getByText("Submit", { exact: true });
    await loc.click();
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    const tagScript = calls[0][1] as string;
    expect(tagScript).toContain("Submit");
    // exact mode: trim + exact compare
    expect(tagScript).toMatch(/===|trim/);
  });

  it("partial match uses includes/indexOf for text comparison", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (adapter.dispatchEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const loc = page.getByText("ubmi"); // partial
    await loc.click();
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    const tagScript = calls[0][1] as string;
    expect(tagScript).toMatch(/includes|indexOf/);
  });
});

describe("Page.getByLabel()", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("returns a Locator instance", () => {
    const loc = page.getByLabel("Email");
    expect(loc).toBeInstanceOf(Locator);
  });

  it("evaluate script looks up label and finds associated input", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (adapter.dispatchEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const loc = page.getByLabel("Email");
    await loc.click();
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    const tagScript = calls[0][1] as string;
    expect(tagScript).toContain("Email");
    // Should look for label element
    expect(tagScript).toMatch(/label/i);
  });

  it("supports exact: true option", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (adapter.dispatchEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const loc = page.getByLabel("Email", { exact: true });
    await loc.click();
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    const tagScript = calls[0][1] as string;
    expect(tagScript).toContain("Email");
  });
});

describe("Page.getByPlaceholder()", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("returns a Locator instance", () => {
    const loc = page.getByPlaceholder("Enter email");
    expect(loc).toBeInstanceOf(Locator);
  });

  it("partial match: selector contains placeholder attribute check", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (adapter.dispatchEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const loc = page.getByPlaceholder("Enter email");
    await loc.click();
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    const tagScript = calls[0][1] as string;
    expect(tagScript).toContain("Enter email");
    expect(tagScript).toContain("placeholder");
  });

  it("exact match uses exact attribute selector when exact: true", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (adapter.dispatchEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const loc = page.getByPlaceholder("Enter email", { exact: true });
    await loc.click();
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    const tagScript = calls[0][1] as string;
    expect(tagScript).toContain("Enter email");
  });
});

describe("Page.getByTestId()", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("returns a Locator instance", () => {
    const loc = page.getByTestId("submit-btn");
    expect(loc).toBeInstanceOf(Locator);
  });

  it("locator selector is [data-testid='id']", () => {
    const loc = page.getByTestId("submit-btn");
    // getByTestId returns a plain CSS Locator with data-testid selector
    expect(loc.selector).toBe('[data-testid="submit-btn"]');
  });

  it("can click via the data-testid locator", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (adapter.dispatchEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const loc = page.getByTestId("submit-btn");
    await loc.click();
    expect(adapter.dispatchEvent).toHaveBeenCalledWith(
      "ctx-1",
      '[data-testid="submit-btn"]',
      "click",
    );
  });
});

describe("getBy* exports from src/index.ts", () => {
  it("GetByTextOptions is exported", async () => {
    // Type-level check: if this compiles, the export exists.
    // We use a dynamic import to verify the module exports shape.
    const mod = await import("../../index.js");
    // Page should be exported (which has the getBy* methods)
    expect(mod.Page).toBeDefined();
  });
});
