import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Locator, type Page } from "playwright";

import { resolveBaseUrl, resolvePreviewCoreUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user finds a finished Task by words that are only in its result, on
// the Tasks search and from Search (Cmd+K). A new user has no free way to get
// a result from someone else, so they finish their own Task with a written
// result through their own API key, as a Coworker would through the API.
// Writes only on a PR preview, only to that user's own Task. The key stays in
// memory: it is never logged and no screenshot is taken while it shows.
const BASE_URL = resolveBaseUrl(process.env);
const CORE = (() => {
  try {
    return { url: resolvePreviewCoreUrl(BASE_URL), skip: false as const };
  } catch (error) {
    return { url: "", skip: (error as Error).message };
  }
})();
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
// Words in the result only: the brief and the name Sokosumi gives never say them.
const NEEDLE = "annual discount";
const RESULT = [
  "# Competitor pricing",
  "",
  "Acme charges 49 a month. Their annual discount is 20%,",
  "so a yearly plan costs 470.",
].join("\n");

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
}

// The words sit inside the excerpt's box: not cut by its line clamp.
async function matchInView(excerpt: Locator) {
  const inView = await excerpt.evaluate((element, words) => {
    const text = [...element.childNodes].find((node) =>
      node.textContent?.includes(words),
    );
    if (!text || text.nodeType !== Node.TEXT_NODE) return false;
    const range = document.createRange();
    const at = (text.textContent ?? "").indexOf(words);
    range.setStart(text, at);
    range.setEnd(text, at + words.length);
    const match = range.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return (
      match.width > 0 &&
      match.right <= box.right + 1 &&
      match.bottom <= box.bottom + 1
    );
  }, NEEDLE);
  assert.ok(inView, `"${NEEDLE}" is cut from the excerpt`);
}

// The page keeps the other layout's copy, hidden.
function visibleExcerpt(page: Page) {
  return page.getByText(/annual discount is 20%/).filter({ visible: true });
}

// Phone: the floating Create task button. Tablet: open the sidebar first.
async function createOwnTask(page: Page) {
  await page.goto(`${BASE_URL}/tasks`);
  await page.getByRole("heading", { name: "Backlog" }).waitFor();
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
    .fill("Compare what Acme charges per month with our plans");
  await newTask.getByRole("button", { name: "Create task" }).click();
  await newTask
    .getByRole("button", { name: "Bring me to the task" })
    .click({ timeout: 120_000 });
  await page.waitForURL(/\/tasks\/[0-9a-f-]{36}$/);
  const name = await page.getByRole("heading", { level: 1 }).innerText();
  return { id: page.url().split("/").pop() as string, name };
}

async function createApiKey(page: Page) {
  await page.goto(`${BASE_URL}/developer/api-keys`);
  // A click before the list lands opens nothing.
  await page.getByText("Create your first API key").waitFor();
  const dialog = page.getByRole("dialog", { name: "Create new API key" });
  await page.getByRole("button", { name: "Create" }).click();
  await dialog
    .waitFor({ timeout: 5_000 })
    .catch(() => page.getByRole("button", { name: "Create" }).click());
  await dialog.getByRole("textbox", { name: "Name" }).fill("E2E result");
  await dialog.getByRole("button", { name: "Create API key" }).click();
  const created = page.getByRole("dialog", { name: "New API key created" });
  const key = await created
    .getByRole("button")
    .filter({ hasNotText: /^(Done|Close)$/ })
    .first()
    .innerText();
  await created.getByRole("button", { name: "Done" }).click();
  return key.trim();
}

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  console.log(`E2E_BASE_URL=${BASE_URL}`);
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name: size, isMobile, ...viewport } of PROJECTS) {
  describe(size, { skip: CORE.skip }, () => {
    test("finds a Task by words only in its result", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}search-task-results-${size}-${step}.png`,
        });

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

      const task = await createOwnTask(page);
      assert.ok(
        !task.name.toLowerCase().includes(NEEDLE),
        "the Task's name already says the words",
      );
      const key = await createApiKey(page);
      // Native fetch: no redirects, so the key goes only to the paired Core.
      const finished = await fetch(`${CORE.url}/v1/tasks/${task.id}/events`, {
        method: "POST",
        redirect: "manual",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "COMPLETED", comment: RESULT }),
      });
      assert.equal(finished.status, 201, "finishing the Task failed");

      // Tasks search: the card says the words were found in the result.
      await page.goto(`${BASE_URL}/tasks`);
      await page.getByRole("heading", { name: "Backlog" }).waitFor();
      const search = page.getByRole("searchbox").first();
      if (!(await search.isVisible())) {
        await page
          .getByRole("button", { name: /search/i })
          .first()
          .click();
      }
      await search.fill(NEEDLE);
      const card = page.getByRole("article").filter({ hasText: task.name });
      await card.getByText("In result").waitFor({ timeout: 60_000 });
      await matchInView(card.getByText(/annual discount is 20%/));
      await noSidewaysScroll(page);
      await shot("1-tasks-search");

      // List view, beside an open sidebar where there is one: the row's
      // excerpt still shows the words.
      const showSidebar = page.getByRole("button", { name: "Show sidebar" });
      if (await showSidebar.isVisible()) await showSidebar.click();
      await page.getByRole("button", { name: "View options" }).click();
      await page.getByRole("radio", { name: "List" }).click();
      await page.keyboard.press("Escape");
      await matchInView(visibleExcerpt(page));
      await noSidewaysScroll(page);
      await shot("2-tasks-list");

      // Search (Cmd+K) offers the Tasks search for what was typed.
      await page.goto(`${BASE_URL}/`);
      if (await showSidebar.isVisible()) await showSidebar.click();
      await page
        .getByRole("button", { name: /^Search/ })
        .first()
        .click();
      await page.getByRole("dialog").getByRole("combobox").fill(NEEDLE);
      const tasksSearch = page.getByRole("option", {
        name: `Search tasks and results for “${NEEDLE}”`,
      });
      await tasksSearch.waitFor({ timeout: 60_000 });
      await page.waitForLoadState("networkidle");
      // Nothing above it says nothing was found.
      assert.equal(await page.getByText("No results found").count(), 0);
      await shot("3-search");
      await tasksSearch.click();
      await page.waitForURL(/\/tasks\?q=annual/);
      await matchInView(visibleExcerpt(page));
      await noSidewaysScroll(page);
      await shot("4-from-search");

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
