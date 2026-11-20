import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user makes a Task Schedule whose name holds {date}: Add date puts the
// token in the name and keeps focus there, the status line shows the next
// Task's name, and Run now creates a Task named with today's date. The
// schedule is unassigned, so the Task waits on the board and nothing runs or
// costs credits. Each size signs up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const DATE = /\d{4}-\d{2}-\d{2}/;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}schedule-task-name-dates-${size}-${step}.png`,
  });
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
}

// Phone: the You tab is the menu. Tablet: open the sidebar first.
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
  await page.waitForURL(/\/schedules/);
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
    test("a schedule's {date} lands in each run's Task name", async () => {
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
      const name = dialog.getByRole("textbox", { name: "Name" });
      const status = dialog.getByRole("status");
      await name.fill("Weekly report");
      assert.equal(
        await name.getAttribute("aria-describedby"),
        await status.getAttribute("id"),
      );
      await dialog.getByRole("button", { name: "Add date" }).click();
      assert.equal(await name.inputValue(), "Weekly report {date}");
      assert.ok(await name.evaluate((el) => el === document.activeElement));
      const preview = (await status.innerText()).trim();
      assert.match(preview, /^Next task: Weekly report \d{4}-\d{2}-\d{2}$/);
      await noSidewaysScroll(page);
      await shot(page, size, "1-preview");

      // Creating opens the schedule's page, which keeps the name as written.
      await dialog.getByRole("button", { name: "Create schedule" }).click();
      await page
        .getByRole("heading", { level: 1, name: "Weekly report {date}" })
        .waitFor();

      await page.getByRole("button", { name: "Run now" }).click();
      await page.getByRole("button", { name: "Open task" }).click();
      const heading = page.getByRole("heading", { level: 1 });
      await heading.filter({ hasText: DATE }).waitFor();
      const taskName = (await heading.innerText()).trim();
      assert.match(taskName, /^Weekly report \d{4}-\d{2}-\d{2}$/);
      assert.ok(!taskName.includes("{date}"));
      await noSidewaysScroll(page);
      await shot(page, size, "2-task");

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
