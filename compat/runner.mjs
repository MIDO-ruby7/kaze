#!/usr/bin/env node
/**
 * compat/runner.mjs — Generic Playwright-compat test runner for kaze
 *
 * Usage:
 *   node compat/runner.mjs <spec-file> [--base-url=http://...] [--json] [--workers=N]
 *
 * The spec file is imported; it should register tests via compat/shim.mjs
 * (or directly via kaze's test API).  After import, collectTestCases is called
 * and the Scheduler executes the tests against a BrowserPool.
 *
 * Flags:
 *   --base-url=<url>   Override KAZE_BASE_URL (also sets process.env)
 *   --json             Write results to compat-results.json in addition to stdout
 *   --workers=N        Browser pool workers (default: 2)
 *   --help             Show this help message
 */

import { createRequire } from "node:module"
import { resolve, isAbsolute } from "node:path"
import { writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const __cwd = process.cwd()

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage: node compat/runner.mjs <spec-file> [options]

Options:
  --base-url=<url>   Base URL for page.goto() relative paths (also via KAZE_BASE_URL)
  --json             Also write results to compat-results.json
  --workers=N        Number of parallel browser workers (default: 2)
  --help             Show this message
`.trim())
  process.exit(0)
}

let specFile = null
let baseUrl = process.env.KAZE_BASE_URL ?? ""
let outputJson = false
let workers = 2

for (const arg of args) {
  if (arg.startsWith("--base-url=")) {
    baseUrl = arg.slice("--base-url=".length)
  } else if (arg.startsWith("--workers=")) {
    workers = parseInt(arg.slice("--workers=".length), 10)
  } else if (arg === "--json") {
    outputJson = true
  } else if (!arg.startsWith("--")) {
    specFile = arg
  }
}

if (!specFile) {
  console.error("Error: spec file required.\n  node compat/runner.mjs <spec-file>")
  process.exit(1)
}

if (baseUrl) {
  process.env.KAZE_BASE_URL = baseUrl
  process.env.BASE_URL = baseUrl
}

// ---------------------------------------------------------------------------
// Load kaze internals
// ---------------------------------------------------------------------------

let collectTestCases, BrowserPool, Scheduler

try {
  ;({ collectTestCases } = await import("../dist/index.js"))
  // BrowserPool and Scheduler are internal — import from source via tsx loader
  ;({ BrowserPool } = await import("../src/pool/BrowserPool.js"))
  ;({ Scheduler } = await import("../src/scheduler/Scheduler.js"))
} catch (err) {
  console.error("Failed to load kaze. Run `pnpm install` first.\n", err.message)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Import spec file (registers tests)
// ---------------------------------------------------------------------------

const specPath = isAbsolute(specFile) ? specFile : resolve(__cwd, specFile)

console.log(`\nkaze compat runner`)
console.log(`  spec  : ${specPath}`)
if (baseUrl) console.log(`  url   : ${baseUrl}`)
console.log(`  workers: ${workers}`)
console.log("")

try {
  await import(pathToFileURL(specPath).href)
} catch (err) {
  console.error(`Failed to import spec file: ${specPath}`)
  console.error(err.message)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const pool = new BrowserPool({ workers })
await pool.init()

let cases
try {
  cases = collectTestCases(pool)
} catch (err) {
  console.error("collectTestCases failed:", err.message)
  await pool.close()
  process.exit(1)
}

if (cases.length === 0) {
  console.warn("No test cases found. Make sure your spec file uses kaze's test() API.")
  await pool.close()
  process.exit(0)
}

console.log(`Running ${cases.length} test(s)...\n`)

const scheduler = new Scheduler(pool)
scheduler.enqueue(cases)

const startAll = Date.now()
const results = await scheduler.run()
const totalMs = Date.now() - startAll

// ---------------------------------------------------------------------------
// Classify failures by API type
// ---------------------------------------------------------------------------

const API_PATTERNS = [
  { pattern: /evaluate is not a function/i,    id: "PW002", api: "page.evaluate" },
  { pattern: /getByRole/i,                      id: "PW001", api: "page.getByRole" },
  { pattern: /getByText/i,                      id: "PW003", api: "page.getByText" },
  { pattern: /getByLabel/i,                     id: "PW004", api: "page.getByLabel" },
  { pattern: /getByPlaceholder/i,               id: "PW005", api: "page.getByPlaceholder" },
  { pattern: /getByTestId/i,                    id: "PW006", api: "page.getByTestId" },
  { pattern: /waitForLoadState/i,               id: "PW007", api: "page.waitForLoadState" },
  { pattern: /waitForURL/i,                     id: "PW008", api: "page.waitForURL" },
  { pattern: /locator.*frame/i,                 id: "PW009", api: "frameLocator" },
  { pattern: /drag/i,                           id: "PW010", api: "page.dragAndDrop" },
]

function classifyError(message) {
  for (const { pattern, id, api } of API_PATTERNS) {
    if (pattern.test(message)) return { id, api }
  }
  return null
}

// ---------------------------------------------------------------------------
// Display results
// ---------------------------------------------------------------------------

let passed = 0
let failed = 0
const apiFailures = new Map()

for (const r of results) {
  if (r.status === "passed") {
    passed++
    console.log(`  PASS  ${r.name}  (${r.durationMs}ms)`)
  } else {
    failed++
    const errMsg = r.error?.message ?? String(r.error ?? "unknown error")
    console.log(`  FAIL  ${r.name}  (${r.durationMs}ms)`)
    console.log(`        ${errMsg}`)

    const classified = classifyError(errMsg)
    if (classified) {
      const key = classified.id
      if (!apiFailures.has(key)) {
        apiFailures.set(key, { ...classified, count: 0, tests: [] })
      }
      const entry = apiFailures.get(key)
      entry.count++
      entry.tests.push(r.name)
    }
  }
}

console.log(`\n${"-".repeat(60)}`)
console.log(`Results: ${passed} passed, ${failed} failed  (${totalMs}ms total)`)

if (apiFailures.size > 0) {
  console.log(`\nCompatibility issues detected:`)
  for (const { id, api, count, tests } of apiFailures.values()) {
    console.log(`  [${id}] ${api} — ${count} test(s) affected`)
    for (const t of tests) console.log(`         - ${t}`)
  }
  console.log(`\n  See compat/issues.json for known issues and workarounds.`)
}

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

const summary = {
  timestamp: new Date().toISOString(),
  specFile: specPath,
  baseUrl,
  totalMs,
  passed,
  failed,
  results: results.map(r => ({
    name:       r.name,
    status:     r.status,
    durationMs: r.durationMs,
    error:      r.error?.message ?? null,
    apiIssue:   r.error ? classifyError(r.error.message ?? "") : null,
  })),
  compatibilityIssues: [...apiFailures.values()],
}

if (outputJson) {
  const outPath = resolve(__cwd, "compat-results.json")
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n")
  console.log(`\nResults written to ${outPath}`)
}

await pool.close()
process.exit(failed > 0 ? 1 : 0)
