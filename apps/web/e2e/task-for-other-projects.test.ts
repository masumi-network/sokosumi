import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user makes two Projects, creates a Draft Task in the first, and from
// the New task success step makes the same Task as a Draft in the second.
// Each size signs up its own disposable mail.tm inbox; everything is free:
// the Tasks are Drafts assigned to the user, so nothing runs.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const BRIEF = "Write a short shop window sign for the Sunday market";

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}task-for-other-projects-${size}-${step}.png`,
  });
}

async function createProject(page: Page, name: string) {
  await page.goto(`${BASE_URL}/projects`);
  await page
    .getByRole("button", { name: /^(New project|Create project)$/ })
    .first()
    .click();
  const wizard = page.getByRole("dialog", { name: "New project" });
  await wizard.getByLabel("Project name").fill(name);
  await wizard.getByRole("button", { name: "Continue" }).click();
  await wizard.getByRole("button", { name: "Continue" }).click();
  await wizard.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("heading", { level: 1, name }).waitFor();
}

// Phone: the floating Create task button. Tablet: open the sidebar first.
async function openNewTask(page: Page) {
  const fab = page.getByRole("button", { name: "Create task" });
  const showSidebar = page.getByRole("button", { name: "Show sidebar" });
  const newTaskButton = page.getByRole("button", { name: "New task" });
  await fab.or(showSidebar).or(newTaskButton).first().waitFor();
  if (await fab.isVisible()) await fab.click();
  else {
    if (await showSidebar.isVisible()) await showSidebar.click();
    await newTaskButton.click();
  }
  return page.getByRole("dialog", { name: "New task" });
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
    test("New task makes the same Draft in another Project", async () => {
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

      await createProject(page, "North Bakery");
      await createProject(page, "South Bakery");

      await page.goto(`${BASE_URL}/tasks`);
      await page.getByRole("heading", { name: "Backlog" }).waitFor();
      const newTask = await openNewTask(page);
      await newTask.getByRole("button", { name: /E2E Tester/ }).click();
      await newTask.getByRole("button", { name: /Start from scratch/ }).click();
      await newTask.getByRole("textbox", { name: "Details" }).fill(BRIEF);
      await newTask.getByRole("combobox", { name: "Project" }).click();
      await page.keyboard.type("North");
      await page.getByText("North Bakery").last().waitFor();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await newTask.getByRole("button", { name: "Create task" }).click();

      const toggle = newTask.getByRole("button", {
        name: "Also for other projects",
      });
      await toggle.click({ timeout: 120_000 });
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      // The Project the Task is already in is not offered.
      assert.equal(
        await newTask.getByRole("checkbox", { name: "North Bakery" }).count(),
        0,
      );
      await newTask.getByRole("checkbox", { name: "South Bakery" }).click();
      await newTask.getByRole("button", { name: "Create 1 draft" }).click();

      const open = newTask.getByRole("link", { name: "Open South Bakery" });
      await open.waitFor({ timeout: 60_000 });
      await newTask.getByRole("status").getByText("1 draft created").waitFor();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
      await shot(page, size, "1-copied");

      await open.click();
      await page.waitForURL(/\/tasks\/SOU-1-/);
      await page.getByRole("heading", { level: 1 }).waitFor();
      await shot(page, size, "2-copy");

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
