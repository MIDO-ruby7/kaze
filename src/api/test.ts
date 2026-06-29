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

/** Minimal interface so test.ts doesn't import BrowserPool directly (avoids circular deps). */
interface AdapterResolver {
  getAdapter(adapterId: string): ProtocolAdapter;
}

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
 * objects. The `pool` is used to resolve the correct ProtocolAdapter for each
 * PooledContext (since the pool manages adapter instances internally).
 *
 * This clears the internal registry after conversion so tests are not
 * duplicated across multiple `collectTestCases()` calls.
 */
export function collectTestCases(pool: AdapterResolver): TestCase[] {
  const pending = _registry.splice(0);

  return pending.map((p) => ({
    id: p.id,
    name: p.name,
    timeout: p.timeout,
    fn: async (ctx: PooledContext): Promise<void> => {
      const adapter = pool.getAdapter(ctx.adapterId);
      const page = createPage(adapter, ctx);
      // Note: do NOT call page.close() here — the pool manages context lifecycle
      await p.fn(page);
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
