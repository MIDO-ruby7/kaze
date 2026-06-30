/**
 * test — Playwright-compatible test registration API.
 *
 * AC-4: test(name, fn) / test.describe(name, fn)
 *       Converts registered tests into Scheduler TestCase format.
 *
 * Hooks: beforeAll / afterAll / beforeEach / afterEach
 *   - Scoped to the enclosing describe block (or root if outside describe).
 *   - beforeEach / afterEach run around every test in scope.
 *   - beforeAll runs once before the first test in scope starts.
 *   - afterAll runs once after the last test in scope finishes.
 */

import type { PooledContext } from "../pool/types.js";
import type { ProtocolAdapter } from "../protocol/index.js";
import type { TestCase } from "../scheduler/types.js";

import type { Page } from "./Page.js";
import { createPage } from "./Page.js";

/** Minimal interface so test.ts doesn't import BrowserPool directly. */
interface AdapterResolver {
  getAdapter(adapterId: string): ProtocolAdapter;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** A pending test registration (before adapter is available). */
interface PendingTest {
  id: string;
  name: string;
  fn: (page: Page) => Promise<void>;
  timeout?: number;
  /** The describe scope path at registration time (e.g. "Suite A > Suite B"). */
  scope: string;
  /** Number of retries for this test (from test.retry(n)). */
  retries?: number;
}

type HookFn = () => Promise<void> | void;
type HookType = "beforeEach" | "afterEach" | "beforeAll" | "afterAll";

interface RegisteredHook {
  type: HookType;
  fn: HookFn;
  /** The describe scope at which this hook was registered. */
  scope: string;
}

// ---------------------------------------------------------------------------
// Module-level registry
// ---------------------------------------------------------------------------

let _registry: PendingTest[] = [];
let _hooks: RegisteredHook[] = [];
let _idCounter = 0;
let _currentDescribe = "";

/**
 * Whether any test.only / test.describe.only has been registered in this file run.
 *
 * NOTE (AC-12 — cross-file scope):
 * `_onlyMode` is a module-level singleton. `runner.ts` imports all spec files
 * and then calls `collectTestCases` once. Therefore, if **any** spec file
 * registers a `test.only` or `test.describe.only`, **all** other tests across
 * every spec file in the same `collectTestCases` call are excluded — not just
 * the tests in the file that contains the `.only`.
 * This mirrors Playwright's global `.only` behaviour.
 */
let _onlyMode = false;
/** Set of full names registered via test.only or test.describe.only. */
const _onlyNames = new Set<string>();

function nextId(): string {
  return `test-${++_idCounter}`;
}

// ---------------------------------------------------------------------------
// test(name, fn)
// ---------------------------------------------------------------------------

interface TestFn {
  (name: string, fn: (page: Page) => Promise<void>, opts?: { timeout?: number }): void;
  only: (name: string, fn: (page: Page) => Promise<void>, opts?: { timeout?: number }) => void;
  skip: (name: string, fn: (page: Page) => Promise<void>) => void;
  describe: DescribeFn;
  retry: (retries: number) => (name: string, fn: (page: Page) => Promise<void>, opts?: { timeout?: number }) => void;
}

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
    scope: _currentDescribe,
  });
}

// ---------------------------------------------------------------------------
// test.describe(name, fn)
// ---------------------------------------------------------------------------

interface DescribeFn {
  (name: string, fn: () => void): void;
  only: (name: string, fn: () => void) => void;
  skip: (name: string, fn: () => void) => void;
}

const describeFn: DescribeFn = function describe(name: string, fn: () => void): void {
  const prev = _currentDescribe;
  _currentDescribe = prev ? `${prev} > ${name}` : name;
  try {
    fn();
  } finally {
    _currentDescribe = prev;
  }
};

/** test.describe.only — runs all tests inside the block; others (outside) are excluded. AC-2 */
describeFn.only = function describeOnly(name: string, fn: () => void): void {
  _onlyMode = true;
  const prev = _currentDescribe;
  const scopeName = prev ? `${prev} > ${name}` : name;
  _currentDescribe = scopeName;

  // Capture registry length before running fn so we can mark tests as "only"
  const before = _registry.length;
  try {
    fn();
  } finally {
    _currentDescribe = prev;
  }
  // Mark all tests registered inside this describe as "only"
  for (let i = before; i < _registry.length; i++) {
    _onlyNames.add(_registry[i]!.name);
  }
};

/** test.describe.skip — skips all tests inside the block. AC-4 */
describeFn.skip = function describeSkip(_name: string, _fn: () => void): void {
  // Simply do not execute fn — no tests are registered.
};

testFn.describe = describeFn;

// ---------------------------------------------------------------------------
// test.only(name, fn) — AC-1
// ---------------------------------------------------------------------------

testFn.only = function only(
  name: string,
  fn: (page: Page) => Promise<void>,
  opts?: { timeout?: number },
): void {
  _onlyMode = true;
  const fullName = _currentDescribe ? `${_currentDescribe} > ${name}` : name;
  _onlyNames.add(fullName);
  _registry.push({
    id: nextId(),
    name: fullName,
    fn,
    timeout: opts?.timeout,
    scope: _currentDescribe,
  });
};

// ---------------------------------------------------------------------------
// test.skip(name, fn) — AC-3
// ---------------------------------------------------------------------------

testFn.skip = function skip(
  _name: string,
  _fn: (page: Page) => Promise<void>,
): void {
  // Skipped tests are simply not registered.
};

// ---------------------------------------------------------------------------
// test.retry(n)(name, fn) — AC-1
// ---------------------------------------------------------------------------

testFn.retry = function retry(
  retries: number,
): (name: string, fn: (page: Page) => Promise<void>, opts?: { timeout?: number }) => void {
  return function (
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
      scope: _currentDescribe,
      retries,
    });
  };
};

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

export function beforeAll(fn: HookFn): void {
  _hooks.push({ type: "beforeAll", fn, scope: _currentDescribe });
}

export function afterAll(fn: HookFn): void {
  _hooks.push({ type: "afterAll", fn, scope: _currentDescribe });
}

export function beforeEach(fn: HookFn): void {
  _hooks.push({ type: "beforeEach", fn, scope: _currentDescribe });
}

export function afterEach(fn: HookFn): void {
  _hooks.push({ type: "afterEach", fn, scope: _currentDescribe });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const test = testFn as TestFn;

// ---------------------------------------------------------------------------
// Adapter: convert registered tests into Scheduler TestCases
// ---------------------------------------------------------------------------

/**
 * Returns the full scope chain for a given scope string.
 * e.g. "Suite A > Suite B" → ["", "Suite A", "Suite A > Suite B"]
 */
function scopeChain(scope: string): string[] {
  const parts = scope ? scope.split(" > ") : [];
  const chain: string[] = [""];
  for (let i = 0; i < parts.length; i++) {
    chain.push(parts.slice(0, i + 1).join(" > "));
  }
  return chain;
}

// ---------------------------------------------------------------------------
// collectTestCases options
// ---------------------------------------------------------------------------

export interface CollectOptions {
  /** Regex pattern: only include tests whose name matches (AC-5). */
  grep?: string;
  /** Regex pattern: exclude tests whose name matches (AC-6). */
  grepInvert?: string;
}

/**
 * Convert all registered `test(...)` calls into Scheduler-compatible TestCase
 * objects, wrapping each with beforeAll / afterAll / beforeEach / afterEach hooks.
 *
 * Hook execution order (mirrors Playwright / Jest):
 *   beforeAll (outermost → innermost, once per scope)
 *   beforeEach (outermost → innermost)
 *   test fn
 *   afterEach (innermost → outermost)
 *   afterAll (innermost → outermost, once per scope when last test in scope)
 */
export function collectTestCases(pool: AdapterResolver, opts?: CollectOptions): TestCase[] {
  let pending = _registry.splice(0);
  const hooks = _hooks.splice(0);

  // Apply only-mode filter: if any test.only / test.describe.only was used,
  // only include tests whose full name is in _onlyNames.
  if (_onlyMode) {
    pending = pending.filter((p) => _onlyNames.has(p.name));
  }

  // Apply grep / grepInvert filters (AC-5, AC-6, AC-11)
  if (opts?.grep) {
    let re: RegExp;
    try {
      re = new RegExp(opts.grep);
    } catch {
      console.error(`[kaze] Invalid grep pattern: "${opts.grep}"`);
      process.exit(2);
    }
    pending = pending.filter((p) => re.test(p.name));
  }
  if (opts?.grepInvert) {
    let re: RegExp;
    try {
      re = new RegExp(opts.grepInvert);
    } catch {
      console.error(`[kaze] Invalid grep pattern: "${opts.grepInvert}"`);
      process.exit(2);
    }
    pending = pending.filter((p) => !re.test(p.name));
  }

  // Reset only state so subsequent collectTestCases calls start fresh.
  _onlyMode = false;
  _onlyNames.clear();

  // Count tests per scope for afterAll tracking
  const testCountPerScope = new Map<string, number>();
  for (const t of pending) {
    for (const s of scopeChain(t.scope)) {
      testCountPerScope.set(s, (testCountPerScope.get(s) ?? 0) + 1);
    }
  }

  // Runtime state per scope (shared across all tests via closure)
  const beforeAllPromise = new Map<string, Promise<void>>();
  const afterAllRemaining = new Map<string, number>(testCountPerScope);
  const afterAllResolvers = new Map<string, Array<() => void>>();

  // Pre-build afterAll promises so all tests in a scope can await them
  for (const scope of testCountPerScope.keys()) {
    const scopeHooks = hooks.filter((h) => h.scope === scope && h.type === "afterAll");
    if (scopeHooks.length === 0) continue;
    // Each scope gets a Promise that resolves when afterAll is triggered
    new Promise<void>((resolve) => {
      afterAllResolvers.set(scope, [
        ...(afterAllResolvers.get(scope) ?? []),
        resolve,
      ]);
    });
  }

  return pending.map((p) => ({
    id: p.id,
    name: p.name,
    timeout: p.timeout,
    retries: p.retries,
    fn: async (ctx: PooledContext): Promise<void> => {
      const adapter = pool.getAdapter(ctx.adapterId);
      const page = createPage(adapter, ctx);
      const chain = scopeChain(p.scope);

      // --- beforeAll (once per scope, memoized with Promise) ---
      for (const scope of chain) {
        const scopeHooks = hooks.filter((h) => h.scope === scope && h.type === "beforeAll");
        if (scopeHooks.length === 0) continue;
        if (!beforeAllPromise.has(scope)) {
          beforeAllPromise.set(
            scope,
            (async () => {
              for (const h of scopeHooks) await h.fn();
            })(),
          );
        }
        await beforeAllPromise.get(scope);
      }

      // --- beforeEach (outermost → innermost) ---
      for (const scope of chain) {
        for (const h of hooks.filter((h) => h.scope === scope && h.type === "beforeEach")) {
          await h.fn();
        }
      }

      try {
        await p.fn(page);
      } finally {
        // --- afterEach (innermost → outermost) ---
        for (const scope of [...chain].reverse()) {
          for (const h of hooks.filter((h) => h.scope === scope && h.type === "afterEach")) {
            await h.fn();
          }
        }

        // --- afterAll (innermost → outermost, when last test in scope) ---
        for (const scope of [...chain].reverse()) {
          const remaining = (afterAllRemaining.get(scope) ?? 1) - 1;
          afterAllRemaining.set(scope, remaining);
          if (remaining === 0) {
            for (const h of hooks.filter((h) => h.scope === scope && h.type === "afterAll")) {
              await h.fn();
            }
          }
        }
      }
    },
  }));
}

/**
 * Reset the internal registry and hooks. Useful in tests.
 * @internal
 */
export function _resetRegistry(): void {
  _registry = [];
  _hooks = [];
  _idCounter = 0;
  _currentDescribe = "";
  _onlyMode = false;
  _onlyNames.clear();
}
