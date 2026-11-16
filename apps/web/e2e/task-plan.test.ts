import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user links three Draft Tasks two levels deep and sees the plan on the
// first one: blocker, then the blocker's sub-task nested under it. Each size
// signs up a new throwaway user; Draft Tasks assigned to yourself are free.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
});
after(() => browser.close());

async function signUp(page: Page, lastName: string) {
  const mailbox = await createMailbox();
  await page.goto(`${BASE_URL}/`);
  await page.getByRole("link", { name: "Register" }).click();
  await page.getByRole("heading", { name: "Create your account" }).waitFor();
  await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page
    .getByRole("button", { name: `${mailbox.address} Change email` })
    .waitFor();
  await page.getByRole("textbox", { name: "First name" }).fill("Ada");
  await page.getByRole("textbox", { name: "Last name" }).fill(lastName);
  await page
    .getByRole("textbox", { name: "Code from the email" })
    .pressSequentially(await mailbox.nextCode());
  await page.getByRole("button", { name: "Register" }).click();

  await page
    .getByRole("heading", { name: "How do you want to work?" })
    .waitFor();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Name your Soko Bot" }).waitFor();
  await page.getByRole("link", { name: "Later" }).click();
  await page.waitForURL(`${BASE_URL}/`);
}

/** Fills the open New task dialog for yourself and waits until it is saved. */
async function describeAndCreate(page: Page, details: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Details" }).fill(details);
  await dialog.getByRole("button", { name: "Create task" }).click();
  await dialog.getByRole("heading", { name: "Task created" }).waitFor();
}

async function createRelated(page: Page, kind: string, details: string) {
  await page.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Create related" }).click();
  // A submenu on wide screens, inline items on a phone. Keyboard, not the
  // pointer: moving across the parent menu closes the submenu.
  await page
    .getByRole("menuitem", { name: kind, exact: true })
    .filter({ visible: true })
    .last()
    .press("Enter");
  await describeAndCreate(page, details);
  await page.keyboard.press("Escape");
}

/** The sidebar link to the Task listed under `heading`. */
function relatedLink(page: Page, heading: string) {
  return page
    .getByRole("complementary")
    .getByRole("heading", { name: heading, exact: true })
    .locator("xpath=following-sibling::ul[1]")
    .getByRole("link")
    .first();
}

for (const { name, ...viewport } of PROJECTS) {
  describe(name, () => {
    test("a new user sees blockers and sub-tasks two links deep", async () => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await signUp(page, name);

      // Tasks from the bottom bar on a phone, else the sidebar (behind a
      // toggle on a tablet). The sidebar redraws once chats load; a tap
      // before that can be lost.
      await page.getByRole("heading", { name: "Get your Soko Bot" }).waitFor();
      if (name === "phone") {
        await page
          .getByRole("navigation", { name: "Main navigation" })
          .getByRole("link", { name: "Tasks" })
          .click();
      } else {
        if (name === "tablet") {
          await page.getByRole("button", { name: "Show sidebar" }).click();
        }
        await page.getByText("No direct messages yet.").waitFor();
        await page.getByRole("link", { name: "Tasks", exact: true }).click();
      }
      await page.waitForURL(`${BASE_URL}/tasks`);

      // Root Task, assigned to yourself so nothing runs or costs credits.
      await page
        .getByRole("button", { name: /^(New task|Create task)$/ })
        .filter({ visible: true })
        .first()
        .click();
      const dialog = page.getByRole("dialog", { name: "New task" });
      await dialog
        .getByRole("button", { name: new RegExp(`Ada ${name}$`) })
        .click();
      await dialog.getByRole("button", { name: /^Start from scratch/ }).click();
      await describeAndCreate(page, "Launch the new website");
      await dialog
        .getByRole("button", { name: "Bring me to the task" })
        .click();
      await page.waitForURL(/\/tasks\/[^/]+$/);
      const rootUrl = page.url();

      // One link deep only: the plan adds nothing yet and stays hidden.
      await createRelated(page, "Blocked by", "Write the homepage copy");
      const blocker = relatedLink(page, "Blocked by");
      await blocker.waitFor();
      assert.equal(
        await page
          .getByRole("heading", { name: "Plan around this Task" })
          .count(),
        0,
      );

      // Two links deep: the blocker gets a sub-task.
      await blocker.click();
      await page.waitForURL((url) => url.href !== rootUrl);
      await createRelated(page, "Add sub-task", "Interview the sales lead");
      await relatedLink(page, "Sub-task").waitFor();
      await relatedLink(page, "Blocking").click();
      await page.waitForURL(rootUrl);

      const plan = page.getByRole("list", { name: "Plan around this Task" });
      await plan.waitFor();
      await page.screenshot({ path: `${RESULTS_DIR}task-plan-${name}.png` });
      const rows = plan.getByRole("listitem");
      assert.equal(await rows.count(), 2, "blocker and its sub-task");
      assert.equal(
        await plan.locator(":scope > li > ul").getByRole("link").count(),
        1,
        "the sub-task nests under its blocker",
      );
      assert.equal(
        await plan.getByRole("img", { name: "Blocked by" }).count(),
        1,
      );
      assert.equal(
        await plan.getByRole("img", { name: "Sub-task" }).count(),
        1,
      );

      await context.close();
      assert.deepEqual(errors, []);
    });
  });
}
