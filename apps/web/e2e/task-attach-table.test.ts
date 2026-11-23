import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page, request } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user makes a Files Table from an invented CSV, then writes a New
// Task and adds that Table from the attach menu: after confirming that the
// copy opens by link, the brief links a dated CSV copy of it. The saved
// Task links that copy, and it holds the Table's rows. Free only: the Task is for the user, nothing runs.
// Each size signs up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const LEADS = ["Company,Contact", "Acme,Lena Ortiz", "Globex,Sam Reid"].join(
  "\n",
);

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}attach-table-${size}-${step}.png`,
  });
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
  const newTask = page.getByRole("dialog", { name: "New task" });
  await newTask.getByRole("button", { name: /E2E Tester/ }).click();
  await newTask.getByRole("button", { name: /Start from scratch/ }).click();
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
    test("a new user gives a Task a Table as a CSV copy", async () => {
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

      await page.goto(`${BASE_URL}/drive?view=tables`);
      await page.getByRole("button", { name: "New table" }).click();
      const create = page.getByRole("dialog", { name: "New table" });
      await create.getByLabel("Title").fill("Expo leads");
      await create.locator('input[type="file"]').setInputFiles({
        name: "leads.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(LEADS),
      });
      await create.getByText("Map columns and preview").waitFor();
      await create.getByRole("button", { name: "Create table" }).click();
      await page.waitForURL(/\/drive\/tables\//);
      await page.getByText("Globex", { exact: true }).waitFor();

      await page.goto(`${BASE_URL}/tasks`);
      await page.getByRole("heading", { name: "Backlog" }).waitFor();
      const newTask = await openNewTask(page);
      await newTask
        .getByRole("textbox", { name: "Details" })
        .fill("Write a follow-up email for each lead.");
      await newTask
        .getByRole("button", { name: "Upload file" })
        // The paperclip menu, not the hidden file input's trigger.
        .and(newTask.locator('[aria-haspopup="menu"]'))
        .click();
      await page.getByRole("menuitem", { name: "From a table" }).click();
      const picker = page.getByRole("dialog", { name: "Add a table" });
      await picker
        .getByText("Adds a CSV copy of every row as it is now.", {
          exact: false,
        })
        .waitFor();
      await picker.locator("label", { hasText: "Expo leads" }).click();
      assert.ok(
        await picker.getByRole("radio", { name: /Expo leads/ }).isChecked(),
      );
      await picker
        .getByText("The copy opens for anyone with its link", { exact: false })
        .waitFor();
      await shot(page, size, "1-picker");
      await picker.getByRole("button", { name: "Add copy" }).click();
      await picker.waitFor({ state: "detached" });

      const day = new Date().toLocaleDateString("sv-SE");
      const link = `Expo leads (${day}).csv`;
      await newTask.getByText(link, { exact: false }).first().waitFor();
      await shot(page, size, "2-attached");

      // Save the Task (for the user, so nothing runs) and read the copy it
      // links from a fresh context with no session: it holds the rows.
      await newTask.getByRole("button", { name: "Create task" }).click();
      await newTask
        .getByRole("button", { name: "Bring me to the task" })
        .click({ timeout: 120_000 });
      await page.waitForURL(/\/tasks\//);
      const href = await page
        .locator('a[href$=".csv"]')
        .first()
        .getAttribute("href");
      assert.ok(href, "the saved Task links its CSV copy");
      await shot(page, size, "3-saved");
      const outsider = await request.newContext();
      const csv = await (await outsider.get(href)).text();
      await outsider.dispose();
      assert.equal(
        csv,
        '"Company","Contact"\r\n"Acme","Lena Ortiz"\r\n"Globex","Sam Reid"',
      );

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      await context.close();
      assert.equal(overflow, 0, `page overflows by ${overflow}px`);
      assert.deepEqual(errors, []);
    });
  });
}
