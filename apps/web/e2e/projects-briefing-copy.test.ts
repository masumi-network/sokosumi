import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user with two Projects starts the second one's briefing from the
// first: Edit, Copy from a project, pick it, Save. The menu lists sources
// only once it opens, the copy replaces the draft in the field, Undo (by
// keyboard) brings the draft back, and the first project's briefing stays
// as it was. Each size
// signs up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
// One long unbroken word, so the menu row and the copy status must wrap or
// truncate it inside the edit dialog.
const SOURCE = "E2E-spring-bakery-launch-for-the-whole-neighbourhood-2026";
const TARGET = "E2E autumn bakery";
const BRIEFING =
  "## Goals\nFill the shop on Saturday mornings.\n\n## Audience\nFamilies within ten minutes of the shop.";

const SIZES = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}briefing-copy-${size}-${step}.png`,
  });
}

async function createProject(page: Page, name: string, briefing = "") {
  await page.goto(`${BASE_URL}/projects`);
  await page
    .getByRole("button", { name: /^(New project|Create project)$/ })
    .filter({ visible: true })
    .first()
    .click();
  const wizard = page.getByRole("dialog", { name: "New project" });
  await wizard.getByLabel("Project name").fill(name);
  await wizard.getByRole("button", { name: "Continue" }).click();
  if (briefing) await wizard.getByLabel("Briefing").fill(briefing);
  await wizard.getByRole("button", { name: "Continue" }).click();
  await wizard.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/projects\/[^/?]+$/);
  await page.getByRole("heading", { level: 1, name }).waitFor();
  return page.url();
}

// The page, the edit dialog and the open menu all fit the screen's width.
async function assertNoSidewaysScroll(page: Page, where: string) {
  const wide = await page.evaluate(() =>
    [
      document.documentElement,
      ...document.querySelectorAll('[role="dialog"], [role="menu"]'),
    ]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.getAttribute("role") ?? "page"),
  );
  assert.deepEqual(wide, [], `no sideways scroll ${where}`);
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
    test("a user copies a briefing over a draft, undoes it by keyboard, copies again and saves", async () => {
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

      const sourceUrl = await createProject(page, SOURCE, BRIEFING);
      const targetUrl = await createProject(page, TARGET);

      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Edit" }).click();
      await page.waitForURL(/\/edit$/);
      const field = page.getByRole("textbox", { name: "Briefing" });
      const trigger = page.getByRole("button", { name: "Copy from a project" });
      await field.fill("Draft note.");

      // Copying replaces the draft; Undo, reached by keyboard, restores it.
      await trigger.click();
      await page.getByRole("menuitem", { name: SOURCE }).waitFor();
      await assertNoSidewaysScroll(page, "with the menu open");
      await shot(page, size, "menu");
      await page.getByRole("menuitem", { name: SOURCE }).click();
      await page
        .getByRole("status")
        .getByText(`Copied from ${SOURCE}. Save to keep it.`)
        .waitFor();
      assert.equal(await field.inputValue(), BRIEFING);
      await assertNoSidewaysScroll(page, "with the copy status shown");
      await shot(page, size, "copied");
      await page.keyboard.press("Tab");
      const undo = page.getByRole("button", { name: "Undo" });
      assert.equal(
        await undo.evaluate((el) => el === document.activeElement),
        true,
        "Undo is the next stop after the menu button",
      );
      await page.keyboard.press("Enter");
      assert.equal(await field.inputValue(), "Draft note.");
      await undo.waitFor({ state: "detached" });

      await trigger.click();
      await page.getByRole("menuitem", { name: SOURCE }).click();
      await undo.waitFor();
      assert.equal(await field.inputValue(), BRIEFING);
      await page.getByRole("button", { name: "Save" }).click();
      await page.waitForURL(targetUrl);
      await page
        .getByTestId("project-briefing-content")
        .getByText("Fill the shop on Saturday mornings.")
        .waitFor();
      await shot(page, size, "saved");

      // The source keeps its own briefing.
      await page.goto(sourceUrl);
      await page
        .getByTestId("project-briefing-content")
        .getByText("Fill the shop on Saturday mornings.")
        .waitFor();

      await assertNoSidewaysScroll(page, "on the source project");
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
