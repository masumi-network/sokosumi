import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user opens Schedules through the app's own navigation, creates an
// unassigned weekly schedule (so no Coworker runs and nothing is charged), and
// sees no "Last task" before its first run. After Run now, the row links the
// Task it created with that Task's status, and the link opens that Task. Each
// size signs up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const SCHEDULE_NAME = "Weekly newsletter draft";
// From the You tab the list opens as /schedules?from=you.
const SCHEDULES_URL = /\/schedules(\?.*)?$/;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}schedule-last-task-${size}-${step}.png`,
  });
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
}

// Phone: You tab, then Schedules. Tablet: open the sidebar first.
async function openSchedules(page: Page, size: string) {
  if (size === "phone") {
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "You" })
      .click();
    await page
      .getByRole("navigation", { name: "You" })
      .getByRole("link", { name: "Schedules", exact: true })
      .click();
  } else {
    const showSidebar = page.getByRole("button", { name: "Show sidebar" });
    if (await showSidebar.isVisible()) await showSidebar.click();
    await page.getByRole("link", { name: "Schedules", exact: true }).click();
  }
  await page.waitForURL(SCHEDULES_URL);
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
    test("a schedule's row links its last Task with that Task's status", async () => {
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

      await openSchedules(page, size);
      await page.getByRole("button", { name: "New schedule" }).click();
      const dialog = page.getByRole("dialog", { name: "New schedule" });
      await dialog.getByRole("textbox", { name: "Name" }).fill(SCHEDULE_NAME);
      await dialog
        .getByRole("textbox", { name: "Description" })
        .fill("Draft this week's customer newsletter.");
      await dialog.getByRole("button", { name: "Weekly" }).click();
      await dialog.getByRole("button", { name: "Create schedule" }).click();
      // Creating opens the schedule; go back to the list the way a user does.
      await page
        .getByRole("heading", { level: 1, name: SCHEDULE_NAME })
        .waitFor();
      await page
        .getByRole("main")
        .getByRole("link", { name: "Schedules" })
        .first()
        .click();
      await page.waitForURL(SCHEDULES_URL);

      const row = page.getByTestId("schedule-row").filter({
        hasText: SCHEDULE_NAME,
      });
      await row.waitFor();
      // No Task yet, so nothing to show.
      assert.equal(
        await row.getByRole("link", { name: /^Last task/ }).count(),
        0,
      );

      await row.getByRole("button", { name: "Run now" }).click();
      const lastTask = row.getByRole("link", {
        name: new RegExp(`^Last task: Ready, ${SCHEDULE_NAME}$`),
      });
      await lastTask.waitFor();
      assert.match((await lastTask.getAttribute("href")) ?? "", /^\/tasks\//);
      await noSidewaysScroll(page);
      await shot(page, size, "1-last-task");

      await lastTask.click();
      await page.waitForURL(/\/tasks\//);
      await page
        .getByRole("heading", { level: 1, name: SCHEDULE_NAME })
        .waitFor();
      await noSidewaysScroll(page);
      await shot(page, size, "2-task");

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
