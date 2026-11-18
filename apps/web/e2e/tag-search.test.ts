import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user finds work by its workspace tag in search: tag a Draft Task
// "Design", open search with the keyboard, type "#design" and see the tag and
// its Task (no "No results found"), pick the tag to filter the board, then
// type "desi" and open the Task from the tag's list. Each size signs up its
// own disposable mail.tm inbox; everything it does is free.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const TASK_DETAILS = "Draw the launch logo for the spring campaign";

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}tag-search-${size}-${step}.png`,
  });
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
}

async function openSearch(page: Page, query: string) {
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search" });
  await dialog.getByRole("combobox").fill(query);
  return dialog;
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
    test("a new user finds a tag and its Tasks in search", async () => {
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
      // Phone: the floating Create task button. Tablet: open the sidebar first.
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
      await newTask
        .getByRole("textbox", { name: "Details" })
        .fill(TASK_DETAILS);
      await newTask.getByRole("button", { name: "Add tag" }).click();
      await page
        .getByRole("textbox", { name: "Find or create a tag" })
        .fill("Design");
      await page.getByRole("button", { name: "Design", exact: true }).click();
      await page.keyboard.press("Escape");
      await newTask.getByRole("button", { name: "Create task" }).click();
      await newTask
        .getByRole("button", { name: "Bring me to the task" })
        .click({ timeout: 120_000 });
      const taskName = await page
        .getByRole("heading", { level: 1 })
        .innerText();

      // "#design" matches no Task title, so only the tag group answers it.
      let search = await openSearch(page, "#design");
      const tag = search.getByRole("option", { name: "#Design" });
      await tag.waitFor();
      await search.getByText("Tasks tagged Design").waitFor();
      await search.getByRole("option", { name: taskName }).first().waitFor();
      assert.equal(
        await search.getByText("No results found").count(),
        0,
        "search says No results found next to a matching tag",
      );
      await noSidewaysScroll(page);
      await shot(page, size, "1-search");

      await tag.click();
      await page.waitForURL(/\/tasks\?tag=/);
      await page.getByText("Tags: Design").first().waitFor();
      await shot(page, size, "2-board");

      search = await openSearch(page, "desi");
      await search.getByText("Tasks tagged Design").waitFor();
      await search
        .getByRole("option", { name: taskName, exact: true })
        .first()
        .click();
      await page.getByRole("heading", { level: 1, name: taskName }).waitFor();
      await noSidewaysScroll(page);
      await shot(page, size, "3-task");

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
