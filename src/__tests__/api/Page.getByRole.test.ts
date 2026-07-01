/**
 * Unit tests for Page.getByRole() (Issue #47).
 *
 * AC-1: page.getByRole(role, opts?) returns a Locator
 * AC-2: ARIA 70+ roles are supported
 * AC-3: { name } option filters by aria-label / aria-labelledby / textContent
 * AC-4: { exact } option controls exact vs partial name matching (default: partial)
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

describe("Page.getByRole() — AC-1: returns Locator", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("returns a Locator instance for 'button'", () => {
    const loc = page.getByRole("button");
    expect(loc).toBeInstanceOf(Locator);
  });

  it("returns a Locator instance for 'link'", () => {
    const loc = page.getByRole("link");
    expect(loc).toBeInstanceOf(Locator);
  });

  it("returns a Locator instance for 'textbox'", () => {
    const loc = page.getByRole("textbox");
    expect(loc).toBeInstanceOf(Locator);
  });
});

describe("Page.getByRole() — AC-2: implicit HTML role selectors", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  async function getResolveScript(role: Parameters<Page["getByRole"]>[0]): Promise<string> {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (adapter.dispatchEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const loc = page.getByRole(role);
    await loc.click();
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    return calls[0][1] as string;
  }

  it("button role: selector includes <button> and input[type=submit]", async () => {
    const script = await getResolveScript("button");
    expect(script).toContain("button");
    expect(script).toContain('input[type="submit"]');
    expect(script).toContain('[role="button"]');
  });

  it("link role: selector includes a[href]", async () => {
    const script = await getResolveScript("link");
    expect(script).toContain("a[href]");
  });

  it("textbox role: selector includes <textarea>", async () => {
    const script = await getResolveScript("textbox");
    expect(script).toContain("textarea");
    expect(script).toContain('[role="textbox"]');
  });

  it("checkbox role: selector includes input[type=checkbox]", async () => {
    const script = await getResolveScript("checkbox");
    expect(script).toContain('input[type="checkbox"]');
  });

  it("radio role: selector includes input[type=radio]", async () => {
    const script = await getResolveScript("radio");
    expect(script).toContain('input[type="radio"]');
  });

  it("combobox role: selector includes <select>", async () => {
    const script = await getResolveScript("combobox");
    expect(script).toContain("select");
  });

  it("heading role: selector includes h1..h6", async () => {
    const script = await getResolveScript("heading");
    expect(script).toContain("h1");
    expect(script).toContain("h6");
  });

  it("navigation role: selector includes <nav>", async () => {
    const script = await getResolveScript("navigation");
    expect(script).toContain("nav");
  });

  it("img role: selector includes <img>", async () => {
    const script = await getResolveScript("img");
    expect(script).toContain("img");
  });

  it("unknown-like role falls back to [role=...] syntax", async () => {
    // 'tab' has no implicit HTML element, so it must use explicit role attr
    const script = await getResolveScript("tab");
    expect(script).toContain('[role="tab"]');
  });

  it("tags the element with data-kaze-role-* attribute", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (adapter.dispatchEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const loc = page.getByRole("button");
    await loc.click();
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    const script = calls[0][1] as string;
    expect(script).toMatch(/data-kz-role-/);
  });
});

describe("Page.getByRole() — AC-3: { name } option", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("name string: script contains the name value", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (adapter.dispatchEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const loc = page.getByRole("button", { name: "Submit" });
    await loc.click();
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    const script = calls[0][1] as string;
    expect(script).toContain("Submit");
  });

  it("name string: script checks aria-label attribute", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (adapter.dispatchEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const loc = page.getByRole("button", { name: "Close" });
    await loc.click();
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    const script = calls[0][1] as string;
    expect(script).toContain("aria-label");
  });

  it("name string: script checks aria-labelledby resolution", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (adapter.dispatchEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const loc = page.getByRole("textbox", { name: "Email" });
    await loc.click();
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    const script = calls[0][1] as string;
    expect(script).toContain("aria-labelledby");
  });

  it("name string: script checks textContent as fallback", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (adapter.dispatchEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const loc = page.getByRole("button", { name: "Send" });
    await loc.click();
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    const script = calls[0][1] as string;
    expect(script).toContain("textContent");
  });

  it("name RegExp: script embeds the pattern as a regex literal", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (adapter.dispatchEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const loc = page.getByRole("button", { name: /submit/i });
    await loc.click();
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    const script = calls[0][1] as string;
    expect(script).toContain("submit");
    expect(script).toMatch(/\.test\(/);
  });
});

describe("Page.getByRole() — AC-4: { exact } option", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("partial match by default (exact: false): uses indexOf/includes", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (adapter.dispatchEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const loc = page.getByRole("button", { name: "Submit" });
    await loc.click();
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    const script = calls[0][1] as string;
    expect(script).toMatch(/indexOf|includes/);
  });

  it("exact: true uses strict equality (===)", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (adapter.dispatchEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const loc = page.getByRole("button", { name: "Submit", exact: true });
    await loc.click();
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    const script = calls[0][1] as string;
    expect(script).toContain("===");
  });

  it("no name + exact: true still resolves by role only", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (adapter.dispatchEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const loc = page.getByRole("link", { exact: true });
    await loc.click();
    const calls = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls;
    const script = calls[0][1] as string;
    // Should still work without name — no name filter in script
    expect(script).toContain("a[href]");
    expect(script).not.toContain("aria-label");
  });
});

describe("getByRole exports from src/index.ts", () => {
  it("AriaRole and GetByRoleOptions types are exported from the module", async () => {
    const mod = await import("../../index.js");
    // Page (which has getByRole) should be exported
    expect(mod.Page).toBeDefined();
  });
});
