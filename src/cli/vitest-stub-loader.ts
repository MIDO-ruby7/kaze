/**
 * vitest-stub-loader.ts
 *
 * A Node.js ESM loader hook (used via node:module register()) that intercepts
 * `import "vitest"` requests when running under the kaze CLI and returns a
 * no-op stub. This prevents spec files that contain both kaze `test(...)` calls
 * and vitest `describe/it` wrappers from crashing when vitest's internal state
 * is not initialised.
 */

export function resolve(
  specifier: string,
  context: { parentURL?: string },
  nextResolve: (s: string, c: object) => Promise<{ url: string; shortCircuit?: boolean }>,
): Promise<{ url: string; shortCircuit?: boolean }> {
  if (specifier === "vitest") {
    return Promise.resolve({ url: "kaze:vitest-stub", shortCircuit: true });
  }
  return nextResolve(specifier, context);
}

export function load(
  url: string,
  context: object,
  nextLoad: (u: string, c: object) => Promise<{ format: string; source: string; shortCircuit?: boolean }>,
): Promise<{ format: string; source: string; shortCircuit?: boolean }> {
  if (url === "kaze:vitest-stub") {
    const noop = "() => {}";
    const noopIt = `Object.assign(${noop}, { skip: ${noop}, skipIf: () => ${noop}, only: ${noop}, concurrent: ${noop} })`;
    const source = `
export const describe = Object.assign(${noop}, { skip: ${noop}, only: ${noop} });
export const it = ${noopIt};
export const test = ${noopIt};
export const expect = () => ({});
export const beforeAll = ${noop};
export const afterAll = ${noop};
export const beforeEach = ${noop};
export const afterEach = ${noop};
export const vi = {};
`;
    return Promise.resolve({ format: "module", source, shortCircuit: true });
  }
  return nextLoad(url, context);
}
