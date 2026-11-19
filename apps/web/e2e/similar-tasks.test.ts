import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user creates a Draft Task, starts a second one about the same thing,
// and New task lists the first under "Open tasks with similar titles". The
// match opens in a new tab, so the draft brief stays. Each size signs up its
// own disposable mail.tm inbox; everything it does is free.
//
// Sokosumi names a Task from its brief with its own model, so the name is not
// known up front. The second brief repeats that name, as a teammate pasting
// the same request would, so the match does not depend on the model's words.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const FIRST_BRIEF = "Write the launch newsletter for our new pricing plans";

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}similar-tasks-${size}-${step}.png`,
  });
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
}

// Phone: the floating Create task button. Tablet: open the sidebar first.
async function openNewTask(page: Page, brief: string) {
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
  await newTask.getByRole("button", { name: /E2E Tester/ }).click();
  await newTask.getByRole("button", { name: /Start from scratch/ }).click();
  await newTask.getByRole("textbox", { name: "Details" }).fill(brief);
  return newTask;
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
    test("New task lists an open Task with a similar title", async () => {
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
      let newTask = await openNewTask(page, FIRST_BRIEF);
      // Nothing to match yet.
      assert.equal(
        await newTask.getByRole("region", { name: /similar titles/ }).count(),
        0,
      );
      await newTask.getByRole("button", { name: "Create task" }).click();
      await newTask
        .getByRole("button", { name: "Bring me to the task" })
        .click({ timeout: 120_000 });
      const taskName = await page
        .getByRole("heading", { level: 1 })
        .innerText();
      const taskUrl = page.url();

      await page.goto(`${BASE_URL}/tasks`);
      await page.getByRole("heading", { name: "Backlog" }).waitFor();
      newTask = await openNewTask(page, `${taskName} for the team`);
      const similar = newTask.getByRole("region", {
        name: "Open tasks with similar titles",
      });
      const match = similar.getByRole("link", {
        name: new RegExp(`^${RegExp.escape(taskName)}`),
      });
      await match.waitFor();
      assert.equal(await match.getAttribute("target"), "_blank");
      await newTask
        .getByRole("status")
        .getByText("1 open task with a similar title")
        .waitFor();
      await noSidewaysScroll(page);
      await shot(page, size, "1-similar");

      const [opened] = await Promise.all([
        context.waitForEvent("page"),
        match.click(),
      ]);
      await opened.waitForURL(taskUrl);
      await opened.getByRole("heading", { level: 1, name: taskName }).waitFor();
      // The brief being written stays in the first tab.
      await newTask.getByRole("textbox", { name: "Details" }).waitFor();
      await shot(opened, size, "2-task");

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
