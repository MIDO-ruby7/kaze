/**
 * test — Playwright-compatible test registration API.
 *
 * AC-4: test(name, fn) / test.describe(name, fn)
 *       Converts registered tests into Scheduler TestCase format.
 */

import type { PooledContext } from "../pool/types.js";
import type { ProtocolAdapter } from "../protocol/index.js";
import type { TestCase } from "../scheduler/types.js";

import type { Page } from "./Page.js";
import { createPage } from "./Page.js";

// ---------------------------------------------------------------------------
// Internal registry
// ---------------------------------------------------------------------------

/** A pending test registration (before adapter is available). */
interface PendingTest {
  id: string;
  name: string;
  fn: (page: Page) => Promise<void>;
  timeout?: number;
}

let _registry: PendingTest[] = [];
let _idCounter = 0;
let _currentDescribe = "";

function nextId(): string {
  return `test-${++_idCounter}`;
}

// ---------------------------------------------------------------------------
// test(name, fn)
// ---------------------------------------------------------------------------

function testFn(
  name: string,
  fn: (page: Page) => Promise<void>,
  opts?: { timeout?: number },
): void {
  const fullName = _currentDescribe ? `${_currentDescribe} > ${name}` : name;
  _registry.push({
    id: nextId(),
    name: fullName,
    fn,
    timeout: opts?.timeout,
  });
}

// ---------------------------------------------------------------------------
// test.describe(name, fn)
// ---------------------------------------------------------------------------

testFn.describe = function describe(name: string, fn: () => void): void {
  const prev = _currentDescribe;
  _currentDescribe = prev ? `${prev} > ${name}` : name;
  try {
    fn();
  } finally {
    _currentDescribe = prev;
  }
};

// ---------------------------------------------------------------------------
// test.skip(name, fn) — marks a test as skipped
// ---------------------------------------------------------------------------

testFn.skip = function skip(
  _name: string,
  _fn: (page: Page) => Promise<void>,
): void {
  // Skipped tests are simply not registered.
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const test = testFn;

// ---------------------------------------------------------------------------
// Adapter: convert registered tests into Scheduler TestCases
// ---------------------------------------------------------------------------

/**
 * Convert all registered `test(...)` calls into Scheduler-compatible TestCase
 * objects.  The `adapter` is used to wrap each PooledContext in a Page.
 *
 * This clears the internal registry after conversion so tests are not
 * duplicated across multiple `collectTestCases()` calls.
 */
export function collectTestCases(adapter: ProtocolAdapter): TestCase[] {
  const pending = _registry.splice(0);

  return pending.map((p) => ({
    id: p.id,
    name: p.name,
    timeout: p.timeout,
    fn: async (ctx: PooledContext): Promise<void> => {
      const page = createPage(adapter, ctx);
      try {
        await p.fn(page);
      } finally {
        await page.close();
      }
    },
  }));
}

/**
 * Reset the internal registry.  Useful in tests.
 * @internal
 */
export function _resetRegistry(): void {
  _registry = [];
  _idCounter = 0;
  _currentDescribe = "";
}
