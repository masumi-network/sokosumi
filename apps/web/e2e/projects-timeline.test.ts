import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user's Project with one due Draft Task shows on the Projects
// Timeline, reached from the Projects toolbar: the project row links to the
// project, the Task to itself, and the header stays on All projects. Each
// size signs up its own disposable mail.tm inbox. Nothing is paid.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const PROJECT = "E2E timeline launch";
const BRIEF = "Draft the launch press release";

const SIZES = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

/** Three days from now, so the Task lands in the Timeline's first weeks. */
function dueDay(): string {
  const day = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  return day.toISOString().slice(0, 10);
}

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}projects-timeline-${size}-${step}.png`,
  });
}

async function assertNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
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

for (const { name: size, isMobile, ...viewport } of SIZES) {
  describe(size, () => {
    test("a due Task shows on the Projects Timeline", async () => {
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

      await page.goto(`${BASE_URL}/projects`);
      await page.getByRole("heading", { name: "No projects yet" }).waitFor();
      await page
        .getByRole("button", { name: /^(New project|Create project)$/ })
        .filter({ visible: true })
        .first()
        .click();
      const wizard = page.getByRole("dialog", { name: "New project" });
      await wizard.getByLabel("Project name").fill(PROJECT);
      await wizard.getByRole("button", { name: "Continue" }).click();
      await wizard.getByRole("button", { name: "Continue" }).click();
      await wizard.getByRole("button", { name: "Create project" }).click();
      await page.waitForURL(/\/projects\/[^/?]+$/);
      await page.getByRole("heading", { level: 1, name: PROJECT }).waitFor();

      // A Draft for the user themselves, in the project in scope: free.
      const newTask = await openNewTask(page);
      await newTask.getByRole("button", { name: /E2E Tester/ }).click();
      await newTask.getByRole("button", { name: /Start from scratch/ }).click();
      await newTask.getByRole("textbox", { name: "Details" }).fill(BRIEF);
      await newTask.getByRole("button", { name: "Create task" }).click();
      await newTask
        .getByRole("button", { name: "Bring me to the task" })
        .click({ timeout: 120_000 });
      const taskName = await page
        .getByRole("heading", { level: 1 })
        .innerText();
      await page.getByRole("button", { name: "No due date" }).click();
      await page.getByLabel("Due date").fill(dueDay());
      await page.getByLabel("Due date").press("Enter");
      await page.getByRole("button", { name: /^Due / }).waitFor();

      await page.goto(`${BASE_URL}/projects`);
      await page.getByRole("link", { name: "Timeline" }).click();
      await page.waitForURL(`${BASE_URL}/projects/timeline`);
      const table = page.getByRole("table");
      await table.waitFor();
      const projectLink = table.getByRole("link", { name: PROJECT });
      assert.match(
        (await projectLink.getAttribute("href")) ?? "",
        /^\/projects\/[^/]+$/,
      );
      const taskLink = table.getByRole("link", { name: new RegExp(taskName) });
      await taskLink.waitFor();
      // The Timeline is every project's page, so the header is not scoped.
      assert.equal(
        await page.getByRole("button", { name: "Clear project" }).count(),
        0,
      );
      await assertNoSidewaysScroll(page);
      await shot(page, size, "timeline");

      await taskLink.click();
      await page.waitForURL(/\/tasks\/[^/]+$/);
      await page.getByRole("heading", { level: 1, name: taskName }).waitFor();

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
