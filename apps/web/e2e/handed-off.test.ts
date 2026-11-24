import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user writes a Draft Task for themselves and hands a second Task to a
// Coworker, scheduled two months out so nothing runs or spends credits. The
// Handed off view then lists only the Coworker's Task. Each size signs up its
// own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}handed-off-${size}-${step}.png`,
  });
}

// Phone: the floating Create task button. Tablet: open the sidebar first.
async function openNewTask(page: Page, assignee: RegExp, brief: string) {
  const fab = page.getByRole("button", { name: "Create task" });
  const showSidebar = page.getByRole("button", { name: "Show sidebar" });
  const newTaskButton = page.getByRole("button", { name: "New task" });
  await fab.or(showSidebar).or(newTaskButton).first().waitFor();
  if (await fab.isVisible()) await fab.click();
  else {
    if (await showSidebar.isVisible()) await showSidebar.click();
    await newTaskButton.click();
  }
  const newTask = page.getByRole("dialog", { name: "New task" });
  await newTask.getByRole("button", { name: assignee }).first().click();
  await newTask.getByRole("button", { name: /Start from scratch/ }).click();
  await newTask.getByRole("textbox", { name: "Details" }).fill(brief);
  return newTask;
}

// Two months out, as the datetime-local value.
function laterStart(): string {
  const start = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  return `${start.toISOString().slice(0, 10)}T10:00`;
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
    test("Handed off lists only Tasks someone else works on", async () => {
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

      await page.goto(`${BASE_URL}/tasks`);
      await page.getByRole("heading", { name: "Backlog" }).waitFor();

      let newTask = await openNewTask(
        page,
        /E2E Tester/,
        "Review the photos for the spring newsletter",
      );
      await newTask.getByRole("button", { name: "Create task" }).click();
      await newTask
        .getByRole("button", { name: "Create another task" })
        .click({ timeout: 120_000 });

      newTask = await openNewTaskInOpenDialog(page);
      await newTask.getByRole("button", { name: "Set start time" }).click();
      const startTime = page.getByRole("dialog", { name: "Start time" });
      await startTime.getByLabel("Start at").fill(laterStart());
      await startTime.getByRole("button", { name: "Apply" }).click();
      await newTask.getByRole("button", { name: "Schedule task" }).click();
      await newTask
        .getByRole("button", { name: "Close" })
        .click({ timeout: 120_000 });

      // Both Tasks wait in Backlog: a Draft and a scheduled one.
      const board = page.getByRole("region", { name: "Backlog" });
      await board.getByRole("link").nth(1).waitFor();
      assert.equal(await board.getByRole("link").count(), 2);

      await page.getByRole("radio", { name: "Handed off" }).click();
      await page.waitForURL(/scope=handedOff/);
      await board.getByRole("img", { name: "Elena" }).waitFor();
      await board.getByRole("link").nth(1).waitFor({ state: "detached" });
      assert.equal(await board.getByRole("link").count(), 1);
      assert.equal(
        await board.getByRole("img", { name: "E2E Tester" }).count(),
        0,
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
      await shot(page, size, "handed-off");

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}

// "Create another task" reopens the assignee step in the same dialog.
async function openNewTaskInOpenDialog(page: Page) {
  const newTask = page.getByRole("dialog", { name: "New task" });
  await newTask.getByRole("button", { name: /Elena/ }).first().click();
  await newTask.getByRole("button", { name: /Start from scratch/ }).click();
  await newTask
    .getByRole("textbox", { name: "Details" })
    .fill("Draft a launch plan for the spring newsletter");
  return newTask;
}
