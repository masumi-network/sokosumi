import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";

/**
 * Credit history for a signed-in disposable user with at least one ledger row
 * (a new account's signup credits count). Needs a Playwright storage
 * state file for that user in E2E_STORAGE_STATE (create it per run, never
 * commit it); without one the spec is skipped so the public smoke still runs.
 */
const STORAGE_STATE = process.env.E2E_STORAGE_STATE?.trim();
const BASE_URL = STORAGE_STATE ? resolveBaseUrl(process.env) : "";
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

let browser: Browser;
before(async () => {
  if (!STORAGE_STATE) return;
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
});
after(() => browser?.close());

for (const { name, ...viewport } of PROJECTS) {
  describe(`history ${name}`, { skip: !STORAGE_STATE }, () => {
    test("a search with no match offers to clear it", async () => {
      const context = await browser.newContext({
        viewport,
        storageState: STORAGE_STATE,
      });
      const page = await context.newPage();

      await page.goto(`${BASE_URL}/history?q=e2e-no-such-transaction`);
      await page
        .getByRole("heading", {
          name: "No results for “e2e-no-such-transaction”",
        })
        .waitFor();
      assert.equal(await page.getByText("No transactions yet").count(), 0);
      await page.screenshot({
        path: `${RESULTS_DIR}${name}-history-empty.png`,
      });

      await page.getByRole("link", { name: "Clear filters" }).click();
      await page.waitForURL((url) => !url.searchParams.has("q"));
      await page.getByRole("list").first().waitFor();

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      await context.close();
      assert.equal(overflow, 0, `/history overflows by ${overflow}px`);
    });

    test("the source filter names every source", async () => {
      const context = await browser.newContext({
        viewport,
        storageState: STORAGE_STATE,
      });
      const page = await context.newPage();

      await page.goto(`${BASE_URL}/history`);
      await page.getByRole("button", { name: "Filters" }).click();
      await page.getByText("Source", { exact: true }).click();
      await page.getByText("SEO chat", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByText("App.TransactionHistory", { exact: false })
          .count(),
        0,
      );
      await page.screenshot({
        path: `${RESULTS_DIR}${name}-history-source.png`,
      });
      await context.close();
    });

    test("active filters show as chips that remove only themselves", async () => {
      const context = await browser.newContext({
        viewport,
        storageState: STORAGE_STATE,
      });
      const page = await context.newPage();

      await page.goto(
        `${BASE_URL}/history?q=e2e-no-such-transaction&type=seoChat`,
      );
      const chips = page.getByRole("list", { name: "Active filters" });
      await chips.waitFor();
      assert.deepEqual(await chips.getByRole("listitem").allTextContents(), [
        "Search: e2e-no-such-transaction",
        "Source: SEO chat",
      ]);
      assert.equal(
        await page.getByRole("button", { name: "Filters, 1 active" }).count(),
        1,
      );
      await page.screenshot({
        path: `${RESULTS_DIR}${name}-history-chips.png`,
      });

      await page
        .getByRole("button", {
          name: "Remove filter Search: e2e-no-such-transaction",
        })
        .click();
      await page.waitForURL((url) => !url.searchParams.has("q"));
      assert.equal(new URL(page.url()).searchParams.get("type"), "seoChat");
      await page.getByRole("button", { name: "Clear all" }).waitFor({
        state: "detached",
      });
      assert.deepEqual(await chips.getByRole("listitem").allTextContents(), [
        "Source: SEO chat",
      ]);
      await context.close();
    });
  });
}
