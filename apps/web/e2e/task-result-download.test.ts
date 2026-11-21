import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import JSZip from "jszip";
import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl, resolvePreviewCoreUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user downloads a finished Task result as PDF and Word, named after the Task. A new
// user has no free way to get a result from someone else, so they finish their own Task
// with a written result through their own API key, as a Coworker would through the API.
// Writes only on a PR preview, only to that user's own Task. The key stays in memory: it is
// never logged and no screenshot is taken while it shows.
const BASE_URL = resolveBaseUrl(process.env);
// Anywhere else the spec skips with the reason; it never writes there.
const CORE = (() => {
  try {
    return { url: resolvePreviewCoreUrl(BASE_URL), skip: false as const };
  } catch (error) {
    return { url: "", skip: (error as Error).message };
  }
})();
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const RESULT = [
  "# Spring newsletter launch plan",
  "",
  "## Channels",
  "",
  "- Newsletter to current subscribers",
  "- LinkedIn company page",
  "",
  "## Steps",
  "",
  "1. Draft the issue",
  "2. Review with the team",
  "",
  "| Channel | Budget |",
  "| --- | --- |",
  "| LinkedIn ads | 500 |",
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
    .fill("Launch plan for the spring newsletter: channels, steps and budget");
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
  await page.getByRole("button", { name: "Create" }).click();
  const dialog = page.getByRole("dialog", { name: "Create new API key" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("E2E result");
  await dialog.getByRole("button", { name: "Create API key" }).click();
  const created = page.getByRole("dialog", { name: "New API key created" });
  // The key is the dialog's one button that is neither Done nor Close.
  const key = await created
    .getByRole("button")
    .filter({ hasNotText: /^(Done|Close)$/ })
    .first()
    .innerText();
  await created.getByRole("button", { name: "Done" }).click();
  return key.trim();
}

async function download(page: Page, item: string) {
  await page.getByRole("button", { name: "Download" }).click();
  const [file] = await Promise.all([
    page.waitForEvent("download", { timeout: 90_000 }),
    page.getByRole("menuitem", { name: item }).click(),
  ]);
  return file;
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
    test("a finished Task result downloads as PDF and Word", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
        acceptDownloads: true,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}task-result-download-${size}-${step}.png`,
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
      const key = await createApiKey(page);
      const finished = await page.request.post(
        `${CORE.url}/v1/tasks/${task.id}/events`,
        {
          headers: { authorization: `Bearer ${key}` },
          data: { status: "COMPLETED", comment: RESULT },
        },
      );
      assert.equal(finished.status(), 201, "finishing the Task failed");

      // The board's Done column, then the Task.
      await page.goto(`${BASE_URL}/tasks`);
      await page.getByRole("link", { name: task.name }).click();
      await page
        .getByRole("heading", { name: "Spring newsletter launch plan" })
        .waitFor();
      await page
        .getByRole("button", { name: "Download" })
        .scrollIntoViewIfNeeded();
      await noSidewaysScroll(page);
      await shot("1-result");

      const pdf = await download(page, "Export as PDF");
      assert.equal(pdf.suggestedFilename(), `${task.name}.pdf`);
      const pdfBytes = readFileSync(await pdf.path());
      assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");

      const word = await download(page, "Export as Word document");
      assert.equal(word.suggestedFilename(), `${task.name}.docx`);
      const xml = await (await JSZip.loadAsync(readFileSync(await word.path())))
        .file("word/document.xml")
        ?.async("string");
      assert.ok(xml?.includes("<w:tbl>"), "the Word file has no table");
      assert.ok(xml?.includes('w:val="clear"'), "the header has no clear fill");
      assert.ok(!xml?.includes('w:val="solid"'), "the header is painted solid");
      await shot("2-downloaded");

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
