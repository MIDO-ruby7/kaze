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
    // waitForSelector polls first (truthy = found), then textContent evaluate
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("Hello World") // waitForSelector poll (truthy → found)
      .mockResolvedValueOnce("Hello World"); // textContent evaluate
    const locator = page.locator("#result");
    await vitestExpect(expect(locator).toHaveText("Hello")).resolves.toBeUndefined();
  });

  it("retries and resolves when text eventually matches", async () => {
    const mock = adapter.evaluate as ReturnType<typeof vi.fn>;
    // Each textContent call: waitForSelector poll + textContent evaluate
    mock
      .mockResolvedValueOnce("loading...") // 1st textContent: waitForSelector (truthy → found)
      .mockResolvedValueOnce("loading...") // 1st textContent: textContent evaluate
      .mockResolvedValueOnce("done")       // 2nd textContent: waitForSelector (truthy → found)
      .mockResolvedValueOnce("done");      // 2nd textContent: textContent evaluate

    const locator = page.locator("#result");
    await vitestExpect(
      expect(locator).toHaveText("done", { timeout: 2000 }),
    ).resolves.toBeUndefined();
  });

  it("throws AssertionError on timeout", async () => {
    // waitForSelector poll returns truthy, textContent evaluate returns "nope" repeatedly
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

describe("expect(page).toHaveTitle", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("resolves when title matches", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue("My Page");
    await vitestExpect(expect(page).toHaveTitle("My Page")).resolves.toBeUndefined();
  });

  it("resolves when title matches a RegExp", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue("My Page Title");
    await vitestExpect(expect(page).toHaveTitle(/My Page/)).resolves.toBeUndefined();
  });

  it("throws AssertionError on timeout", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue("Other");
    await vitestExpect(
      expect(page).toHaveTitle("My Page", { timeout: 200 }),
    ).rejects.toBeInstanceOf(AssertionError);
  });
});

describe("expect(locator).toBeChecked", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("resolves when element is checked", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const locator = page.locator("#cb");
    await vitestExpect(expect(locator).toBeChecked()).resolves.toBeUndefined();
  });

  it("throws AssertionError when not checked within timeout", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const locator = page.locator("#cb");
    await vitestExpect(
      expect(locator).toBeChecked({ timeout: 200 }),
    ).rejects.toBeInstanceOf(AssertionError);
  });
});

describe("expect(locator).toBeEnabled / toBeDisabled", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("toBeEnabled resolves when element is enabled", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const locator = page.locator("#btn");
    await vitestExpect(expect(locator).toBeEnabled()).resolves.toBeUndefined();
  });

  it("toBeEnabled throws when disabled within timeout", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const locator = page.locator("#btn");
    await vitestExpect(
      expect(locator).toBeEnabled({ timeout: 200 }),
    ).rejects.toBeInstanceOf(AssertionError);
  });

  it("toBeDisabled resolves when element is disabled", async () => {
    // evaluate returns { found: true, disabled: true }
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue({ found: true, disabled: true });
    const locator = page.locator("#btn");
    await vitestExpect(expect(locator).toBeDisabled()).resolves.toBeUndefined();
  });

  it("toBeDisabled throws when enabled within timeout", async () => {
    // evaluate returns { found: true, disabled: false } — element exists but is enabled
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue({ found: true, disabled: false });
    const locator = page.locator("#btn");
    await vitestExpect(
      expect(locator).toBeDisabled({ timeout: 200 }),
    ).rejects.toBeInstanceOf(AssertionError);
  });

  it("toBeDisabled throws AssertionError when element does not exist", async () => {
    // evaluate returns { found: false, disabled: false } — element absent
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue({ found: false, disabled: false });
    const locator = page.locator("#nonexistent");
    await vitestExpect(
      expect(locator).toBeDisabled({ timeout: 200 }),
    ).rejects.toBeInstanceOf(AssertionError);
  });
});

describe("expect(locator).toHaveValue", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("resolves when input value matches", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true)    // waitForSelector
      .mockResolvedValueOnce("hello"); // inputValue evaluate
    const locator = page.locator("#input");
    await vitestExpect(expect(locator).toHaveValue("hello")).resolves.toBeUndefined();
  });

  it("throws AssertionError when value does not match within timeout", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce("other");
    const locator = page.locator("#input");
    await vitestExpect(
      expect(locator).toHaveValue("hello", { timeout: 200 }),
    ).rejects.toBeInstanceOf(AssertionError);
  });
});

describe("expect(locator).toHaveCount", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("resolves when count matches", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(3);
    const locator = page.locator("li");
    await vitestExpect(expect(locator).toHaveCount(3)).resolves.toBeUndefined();
  });

  it("throws AssertionError when count does not match within timeout", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(2);
    const locator = page.locator("li");
    await vitestExpect(
      expect(locator).toHaveCount(5, { timeout: 200 }),
    ).rejects.toBeInstanceOf(AssertionError);
  });

  it("toHaveCount(0) resolves when element disappears", async () => {
    // count() returning 0 is a valid expectation (element not present / removed from DOM)
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0);
    const locator = page.locator("li");
    await vitestExpect(expect(locator).toHaveCount(0)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// toHaveClass
// ---------------------------------------------------------------------------

describe("expect(locator).toHaveClass", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("resolves when class attribute matches a string (partial)", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue("foo bar baz");
    const locator = page.locator("#el");
    await vitestExpect(expect(locator).toHaveClass("bar")).resolves.toBeUndefined();
  });

  it("resolves when class attribute matches a RegExp", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue("foo bar baz");
    const locator = page.locator("#el");
    await vitestExpect(expect(locator).toHaveClass(/^foo/)).resolves.toBeUndefined();
  });

  it("retries and resolves when class eventually matches", async () => {
    const mock = adapter.evaluate as ReturnType<typeof vi.fn>;
    mock
      .mockResolvedValueOnce("loading")
      .mockResolvedValueOnce("ready");
    const locator = page.locator("#el");
    await vitestExpect(
      expect(locator).toHaveClass("ready", { timeout: 2000 }),
    ).resolves.toBeUndefined();
  });

  it("throws AssertionError when class does not match within timeout", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue("other");
    const locator = page.locator("#el");
    await vitestExpect(
      expect(locator).toHaveClass("active", { timeout: 200 }),
    ).rejects.toBeInstanceOf(AssertionError);
  });
});

// ---------------------------------------------------------------------------
// toHaveAttribute
// ---------------------------------------------------------------------------

describe("expect(locator).toHaveAttribute", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("resolves when attribute value matches a string exactly", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue("submit");
    const locator = page.locator("button");
    await vitestExpect(expect(locator).toHaveAttribute("type", "submit")).resolves.toBeUndefined();
  });

  it("resolves when attribute value matches a RegExp", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue("btn-primary");
    const locator = page.locator("button");
    await vitestExpect(expect(locator).toHaveAttribute("class", /primary/)).resolves.toBeUndefined();
  });

  it("retries and resolves when attribute value eventually matches", async () => {
    const mock = adapter.evaluate as ReturnType<typeof vi.fn>;
    mock
      .mockResolvedValueOnce("loading")
      .mockResolvedValueOnce("done");
    const locator = page.locator("#el");
    await vitestExpect(
      expect(locator).toHaveAttribute("data-state", "done", { timeout: 2000 }),
    ).resolves.toBeUndefined();
  });

  it("throws AssertionError when attribute does not match within timeout", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue("other");
    const locator = page.locator("#el");
    await vitestExpect(
      expect(locator).toHaveAttribute("aria-label", "close", { timeout: 200 }),
    ).rejects.toBeInstanceOf(AssertionError);
  });

  it("throws AssertionError when attribute is absent (null)", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const locator = page.locator("#el");
    await vitestExpect(
      expect(locator).toHaveAttribute("data-missing", "value", { timeout: 200 }),
    ).rejects.toBeInstanceOf(AssertionError);
  });
});

// ---------------------------------------------------------------------------
// toContainText
// ---------------------------------------------------------------------------

describe("expect(locator).toContainText", () => {
  let adapter: ProtocolAdapter;
  let page: Page;

  beforeEach(() => {
    adapter = makeAdapter();
    page = createPage(adapter, ctx);
  });

  it("resolves when text content includes the expected substring", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("Hello World") // waitForSelector
      .mockResolvedValueOnce("Hello World"); // textContent
    const locator = page.locator("#msg");
    await vitestExpect(expect(locator).toContainText("World")).resolves.toBeUndefined();
  });

  it("resolves when text content matches a RegExp", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("Hello World")
      .mockResolvedValueOnce("Hello World");
    const locator = page.locator("#msg");
    await vitestExpect(expect(locator).toContainText(/Wor\w+/)).resolves.toBeUndefined();
  });

  it("retries and resolves when text eventually contains expected", async () => {
    const mock = adapter.evaluate as ReturnType<typeof vi.fn>;
    mock
      .mockResolvedValueOnce("loading...") // 1st textContent: waitForSelector
      .mockResolvedValueOnce("loading...") // 1st textContent: textContent evaluate
      .mockResolvedValueOnce("done!")      // 2nd textContent: waitForSelector
      .mockResolvedValueOnce("done!");     // 2nd textContent: textContent evaluate
    const locator = page.locator("#msg");
    await vitestExpect(
      expect(locator).toContainText("done", { timeout: 2000 }),
    ).resolves.toBeUndefined();
  });

  it("throws AssertionError when text does not contain expected within timeout", async () => {
    (adapter.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue("nope");
    const locator = page.locator("#msg");
    await vitestExpect(
      expect(locator).toContainText("expected", { timeout: 200 }),
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
