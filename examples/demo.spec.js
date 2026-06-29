/**
 * CLI ランナーの動作確認用サンプル（.js で実際の kaze dist から import）
 * 実際のユーザーは `import { test, expect } from 'kaze'` と書く
 */
import { test, expect } from "../dist/index.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureUrl = `file://${join(__dirname, "fixtures/index.html")}`;

test.describe("demo", () => {
  test("goto → click → toHaveText", async (page) => {
    await page.goto(fixtureUrl);
    await page.click("#btn");
    await expect(page.locator("#result")).toHaveText("done");
  });

  test("fill → echo", async (page) => {
    await page.goto(fixtureUrl);
    await page.fill("#input", "hello kaze");
    await expect(page.locator("#echo")).toHaveText("hello kaze");
  });
});
