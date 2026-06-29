/**
 * Unit tests for expect matchers (AC-3).
 */

import { describe, it, expect as vitestExpect, vi, beforeEach } from "vitest";

import { expect, AssertionError } from "../../api/expect.js";
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

describe("expect(locator).toHaveText", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("resolves when text matches immediately", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue("Hello World");
    const locator = page.locator("#result");
    await vitestExpect(expect(locator).toHaveText("Hello")).resolves.toBeUndefined();
  });

  it("retries and resolves when text eventually matches", async () => {
    const mock = adapter.evaluate as ReturnType<typeof vi.fn>;
    mock
      .mockResolvedValueOnce("loading...")
      .mockResolvedValueOnce("loading...")
      .mockResolvedValueOnce("done");

    const locator = page.locator("#result");
    await vitestExpect(
      expect(locator).toHaveText("done", { timeout: 2000 }),
    ).resolves.toBeUndefined();
  });

  it("throws AssertionError on timeout", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue("nope");
    const locator = page.locator("#result");
    await vitestExpect(
      expect(locator).toHaveText("expected", { timeout: 200 }),
    ).rejects.toBeInstanceOf(AssertionError);
  });
});

describe("expect(locator).toBeVisible", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("resolves when element is visible", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const locator = page.locator("#btn");
    await vitestExpect(expect(locator).toBeVisible()).resolves.toBeUndefined();
  });

  it("retries and resolves when element becomes visible", async () => {
    const mock = adapter.evaluate as ReturnType<typeof vi.fn>;
    mock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const locator = page.locator("#btn");
    await vitestExpect(
      expect(locator).toBeVisible({ timeout: 2000 }),
    ).resolves.toBeUndefined();
  });

  it("throws AssertionError when not visible within timeout", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const locator = page.locator("#btn");
    await vitestExpect(
      expect(locator).toBeVisible({ timeout: 200 }),
    ).rejects.toBeInstanceOf(AssertionError);
  });
});

describe("expect(page).toHaveURL", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("resolves when URL matches a string", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(
      "https://example.com/",
    );
    await vitestExpect(
      expect(page).toHaveURL("https://example.com/"),
    ).resolves.toBeUndefined();
  });

  it("resolves when URL matches a RegExp", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(
      "https://example.com/path",
    );
    await vitestExpect(
      expect(page).toHaveURL(/example\.com/),
    ).resolves.toBeUndefined();
  });

  it("throws AssertionError when URL does not match", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(
      "https://other.com/",
    );
    await vitestExpect(
      expect(page).toHaveURL("https://example.com/", { timeout: 200 }),
    ).rejects.toBeInstanceOf(AssertionError);
  });
});
