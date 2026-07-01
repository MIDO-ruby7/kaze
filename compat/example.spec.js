/**
 * compat/example.spec.js — Sample spec using the Playwright-compat shim.
 *
 * This file demonstrates how to write Playwright-style tests that run on kaze.
 * It uses the local HTML fixture (examples/fixtures/index.html) so there are
 * no external dependencies.
 *
 * Run:
 *   KAZE_BASE_URL=file:///$(pwd)/examples/fixtures/index.html \
 *     node compat/runner.mjs compat/example.spec.js
 *
 * Or set KAZE_BASE_URL in your environment.
 *
 * Note: tests will be skipped (no-op) when Chromium is not installed.
 */

import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import * as os from "node:os"
import * as fs from "node:fs"

import { test, expect } from "./shim.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Use local fixture file as base URL if KAZE_BASE_URL is not set
const fixtureUrl =
  process.env.KAZE_BASE_URL ??
  `file://${join(__dirname, "..", "examples", "fixtures", "index.html")}`

// ---------------------------------------------------------------------------
// Guard: skip if Chromium is not installed
// ---------------------------------------------------------------------------

function isChromiumInstalled() {
  const browsersDir = join(os.homedir(), ".kaze", "browsers")
  if (!fs.existsSync(browsersDir)) return false
  return fs.readdirSync(browsersDir).some(e => e.startsWith("chromium-"))
}

const chromiumInstalled = isChromiumInstalled()

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Playwright-compat shim — fixture tests", () => {
  test("goto and check heading text", async ({ page }) => {
    if (!chromiumInstalled) return

    await page.goto(fixtureUrl)
    const heading = await page.locator("#heading")
    await expect(heading).toContainText("kaze Fixture Page")
  })

  test("click button and verify result text", async ({ page }) => {
    if (!chromiumInstalled) return

    await page.goto(fixtureUrl)
    await page.locator("#btn").click()
    const result = await page.locator("#result")
    await expect(result).toContainText("done")
  })

  test("type in input and verify echo", async ({ page }) => {
    if (!chromiumInstalled) return

    await page.goto(fixtureUrl)
    await page.locator("#input").fill("hello kaze")
    const echo = await page.locator("#echo")
    await expect(echo).toContainText("hello kaze")
  })

  test("page.evaluate returns a value", async ({ page }) => {
    if (!chromiumInstalled) return

    await page.goto(fixtureUrl)
    const title = await page.evaluate(() => document.title)
    expect(title).toContain("kaze")
  })

  test("primitive expect — toBeGreaterThan", async ({ page }) => {
    if (!chromiumInstalled) return

    await page.goto(fixtureUrl)
    const count = await page.evaluate(() => document.querySelectorAll("*").length)
    expect(count).toBeGreaterThan(0)
  })

  test("primitive expect — toBeTruthy", async ({ page }) => {
    if (!chromiumInstalled) return

    await page.goto(fixtureUrl)
    const title = await page.evaluate(() => document.title)
    expect(title).toBeTruthy()
  })

  test("page.url() returns the current URL", async ({ page }) => {
    if (!chromiumInstalled) return

    await page.goto(fixtureUrl)
    const url = page.url()
    expect(url).toBeTruthy()
  })
})
