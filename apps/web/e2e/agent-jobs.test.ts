import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";

/**
 * Your jobs for a signed-in user with at least one job with one agent: a
 * search with no match names the query, announces it and offers Clear
 * search, which empties the field and the URL, keeps focus in the field and
 * brings the list back. Read only; nothing is run, paid or changed.
 *
 * A new user has no jobs, and every job pays a real agent, so the spec
 * cannot make its own. It needs a Playwright storage state for such a user
 * in E2E_JOBS_STORAGE_STATE (created per run, never committed) and that
 * agent's id in E2E_JOBS_AGENT_ID; without both it is skipped.
 */
const STORAGE_STATE = process.env.E2E_JOBS_STORAGE_STATE?.trim();
const AGENT_ID = process.env.E2E_JOBS_AGENT_ID?.trim();
const READY = Boolean(STORAGE_STATE && AGENT_ID);
const BASE_URL = READY ? resolveBaseUrl(process.env) : "";
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const MISS = "e2e-no-such-job";

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

let browser: Browser;
before(async () => {
  if (!READY) return;
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
});
after(() => browser?.close());

for (const { name: size, ...viewport } of PROJECTS) {
  describe(`agent jobs ${size}`, { skip: !READY }, () => {
    test("a job search with no match names it and clears", async () => {
      const context = await browser.newContext({
        viewport,
        storageState: STORAGE_STATE,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}agent-jobs-${size}-${step}.png`,
        });

      await page.goto(`${BASE_URL}/agents/${AGENT_ID}`);
      await page.getByRole("link", { name: /^Your jobs \d+/ }).click();
      await page.waitForURL(/\/jobs(\/|$|\?)/);

      const search = page.getByRole("textbox", { name: "Search jobs..." });
      const list = page.locator("aside").filter({ has: search });
      const rows = list.getByRole("listitem");
      await rows.first().waitFor();
      const rowCount = await rows.count();
      // The loading label is gone once the list is in.
      assert.equal(
        await page.locator("#agent-loading-status").textContent(),
        "",
        "the loading announcement clears",
      );
      // The search status stands empty before any search.
      const status = list.getByRole("status");
      assert.equal(await status.textContent(), "");

      await search.fill(MISS);
      await status.filter({ hasText: `No jobs match “${MISS}”.` }).waitFor();
      await page.waitForURL((url) => url.searchParams.get("query") === MISS);
      assert.equal(await rows.count(), 0, "a miss lists no jobs");
      assert.equal(
        await list.getByText(/^\d+ of \d+ jobs?$/).count(),
        0,
        "a miss shows no count",
      );
      await shot("0-miss");

      await list.getByRole("button", { name: "Clear search" }).click();
      await page.waitForURL((url) => !url.searchParams.get("query"));
      assert.equal(await search.inputValue(), "");
      assert.ok(
        await search.evaluate((input) => input === document.activeElement),
        "focus returns to the search field",
      );
      await rows.first().waitFor();
      assert.equal(await rows.count(), rowCount, "the list comes back");
      assert.equal(await status.textContent(), "");

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      await shot("1-cleared");
      await context.close();
      assert.equal(overflow, 0, `Your jobs overflows by ${overflow}px`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
}
