import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

/**
 * Tasks never leave a new user at a dead end: a board search with no match
 * names the search, a comment that fails to send says so, and an archived
 * link to a Task restored since opens the live Task.
 */
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name: size, ...viewport } of PROJECTS) {
  describe(size, () => {
    test("search, comment and archived-link dead ends explain themselves", async () => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      await signUpWithOrganization(page, BASE_URL);

      await page.goto(`${BASE_URL}/tasks`);
      await page
        .getByRole("searchbox", { name: "Search tasks" })
        .fill("zebra podcast");
      await page
        .getByRole("heading", { name: "No tasks match your search" })
        .waitFor();
      const emptySearch = page
        .getByRole("heading", { name: "No tasks match your search" })
        .locator("..");
      await emptySearch.getByText("Nothing matches “zebra podcast”").waitFor();
      // The search field has its own "Clear search" icon; use the empty state's.
      await emptySearch.getByRole("button", { name: "Clear search" }).click();
      const search = page.getByRole("searchbox", { name: "Search tasks" });
      await page.waitForFunction(() => !location.search.includes("q="));
      assert.equal(await search.inputValue(), "");
      assert.ok(
        await search.evaluate((input) => input === document.activeElement),
        "focus did not return to the search field",
      );

      await page.goto(`${BASE_URL}/tasks?create=true`);
      const newTask = page.getByRole("dialog", { name: "New task" });
      await newTask.getByRole("button", { name: /Ada Tester/ }).click();
      await newTask.getByRole("button", { name: /Start from scratch/ }).click();
      await newTask
        .getByRole("textbox", { name: "Details" })
        .fill("Draft three subject lines for the spring newsletter.");
      await newTask.getByRole("button", { name: "Create task" }).click();
      const goToTask = newTask.getByRole("button", {
        name: "Bring me to the task",
      });
      await goToTask.waitFor({ timeout: 120_000 });
      await goToTask.click();
      await page.waitForURL(/\/tasks\/[0-9a-f-]{36}$/);
      const taskUrl = page.url();
      const taskId = taskUrl.split("/").at(-1);
      const title = await page.getByRole("heading", { level: 1 }).innerText();

      await context.setOffline(true);
      await page.getByRole("textbox", { name: "Write a comment..." }).click();
      await page.keyboard.type("Use the bakery case.");
      await page.getByRole("button", { name: "Submit" }).click();
      await page.getByText("Failed to post comment").waitFor();
      await context.setOffline(false);

      await page.getByRole("button", { name: "Archive" }).click();
      await page.waitForURL(/\/tasks(\?|$)/);
      // Archive leaves at once and archives in the background: wait for the
      // row, or the archived link still finds a live Task and opens it.
      await page.goto(`${BASE_URL}/tasks/archived`);
      await page.getByRole("link", { name: title }).click();
      await page.getByRole("button", { name: "Restore" }).click();
      await page.waitForURL(taskUrl);

      // The archived link outlives the restore: it opens the live Task.
      await page.goto(`${BASE_URL}/tasks/archived/${taskId}`);
      await page.waitForURL(taskUrl);
      assert.equal(
        await page.getByRole("heading", { level: 1 }).innerText(),
        title,
      );
      await page.screenshot({
        path: `${RESULTS_DIR}tasks-error-states-${size}.png`,
      });
      await context.close();
    });
  });
}
