import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user saves a table from a Task's activity as a Files Table: a Draft
// Task for themselves (no Coworker runs), a comment holding an invented
// Markdown table, Save as table, then Open table. ZIP codes with leading zeros
// and amounts with a currency sign stay as written. While the comment is
// collapsed the action is hidden and the preview starts at the header; after
// a new comment remounts the row it still links to the same Table. Free only.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const TABLE = [
  "| Company | ZIP | Employees | Budget |",
  "| --- | --- | --- | --- |",
  "| Northwind Labs | 01234 | 12 | $1,200 |",
  "| Quarry Bikes | 00420 | 45 | $3,000 |",
  "| Blue Fern Studio | 98765 | 300 | $8,500 |",
  "| Harbor Cafe | 02139 | 8 | $450 |",
  "| Lumen Print | 10001 | 22 | $2,100 |",
  "| Oak & Ash | 07030 | 5 | $900 |",
];

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}task-result-table-${size}-${step}.png`,
  });
}

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  console.log(`E2E_BASE_URL=${BASE_URL}`);
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name: size, isMobile, ...viewport } of PROJECTS) {
  describe(size, () => {
    test("a new user saves a table from a Task comment as a Files Table", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      const mailbox = await createMailbox();
      await page.goto(`${BASE_URL}/signup`);
      await page.getByLabel("Email").fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByLabel("First name").fill("E2E");
      await page.getByLabel("Last name").fill("Tester");
      await page
        .getByLabel("Code from the email")
        .fill(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("link", { name: "Later" }).click();
      await page.waitForURL(`${BASE_URL}/`);

      // A Draft for themselves: nothing runs and no credits are spent.
      await page.goto(`${BASE_URL}/tasks`);
      const fab = page.getByRole("button", { name: "Create task" });
      const showSidebar = page.getByRole("button", { name: "Show sidebar" });
      const newTaskButton = page.getByRole("button", { name: "New task" });
      await fab.or(showSidebar).or(newTaskButton).first().waitFor();
      if (await fab.isVisible()) await fab.click();
      else {
        if (await showSidebar.isVisible()) await showSidebar.click();
        await newTaskButton.click();
      }
      const dialog = page.getByRole("dialog", { name: "New task" });
      await dialog.getByRole("button", { name: /E2E Tester/ }).click();
      await dialog.getByRole("button", { name: /Start from scratch/ }).click();
      await dialog
        .getByRole("textbox", { name: "Details" })
        .fill("Collect expo lead list for follow-up");
      await dialog.getByRole("button", { name: "Create task" }).click();
      await dialog
        .getByRole("button", { name: "Bring me to the task" })
        .click({ timeout: 60_000 });
      await page.waitForURL(/\/tasks\/[^/]+$/);

      const comment = page.getByRole("textbox", { name: "Write a comment..." });
      await comment.click();
      for (const [i, line] of TABLE.entries()) {
        if (i) await page.keyboard.press("Shift+Enter");
        await page.keyboard.type(line);
      }
      await page.getByRole("button", { name: "Submit" }).click();
      await page.getByText("Company", { exact: true }).waitFor();

      // Collapsed: the preview starts at the header and the action is out of
      // sight and reach (hidden, not faded), so only Expand shows.
      const expand = page.getByRole("button", { name: "Expand" });
      await expand.waitFor();
      const save = page.getByRole("button", { name: "Save as table" });
      assert.equal(await save.isVisible(), false, "action shows while clipped");
      const clampTop = await page
        .getByText("Company", { exact: true })
        .evaluate((cell) => {
          const clamp = cell.closest<HTMLElement>("[style]");
          return clamp ? clamp.scrollTop : -1;
        });
      assert.equal(clampTop, 0, "collapsed preview is scrolled");
      await shot(page, size, "0-collapsed");

      await expand.click();
      await save.scrollIntoViewIfNeeded();
      await shot(page, size, "1-table");
      await save.click();
      await page.getByText("Saved 6 rows to a new table.").waitFor();
      const link = page.getByRole("link", { name: "Open table" });
      const href = await link.getAttribute("href");
      assert.match(href ?? "", /^\/drive\/tables\//);
      await shot(page, size, "2-saved");

      // A new activity event remounts the comment: it still links to the same
      // Table, and offers no second save.
      await comment.click();
      await page.keyboard.type("Saved, thanks");
      await page.getByRole("button", { name: "Submit" }).click();
      await page.getByText("Saved, thanks", { exact: true }).waitFor();
      if (await expand.isVisible()) await expand.click();
      await link.waitFor();
      assert.equal(await link.getAttribute("href"), href);
      assert.equal(await save.count(), 0);

      // Opened inline, from the row that mounted again.
      await link.click();
      await page.waitForURL(/\/drive\/tables\//);
      for (const value of ["01234", "00420", "$1,200", "Quarry Bikes"])
        await page.getByText(value, { exact: true }).first().waitFor();
      await shot(page, size, "3-table");

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      await context.close();
      assert.equal(overflow, 0, `page overflows by ${overflow}px`);
      assert.deepEqual(errors, []);
    });
  });
}
