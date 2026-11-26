import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user with two Projects starts the second one's briefing from the
// first: Edit, Copy from a project, pick it, Save. The copy fills the field
// only until Save, and the first project's briefing stays as it was. Each size
// signs up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const SOURCE = "E2E spring bakery";
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

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  console.log(`E2E_BASE_URL=${BASE_URL}`);
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name: size, isMobile, ...viewport } of SIZES) {
  describe(size, () => {
    test("a user copies another project's briefing, edits nothing else, and saves", async () => {
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
      assert.equal(await field.inputValue(), "");
      await page.getByRole("button", { name: "Copy from a project" }).click();
      await shot(page, size, "menu");
      await page.getByRole("menuitem", { name: SOURCE }).click();
      assert.equal(await field.inputValue(), BRIEFING);
      await page.getByText(`Copied the briefing from ${SOURCE}`).waitFor();
      await shot(page, size, "copied");

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

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      assert.equal(overflow, false, "no sideways page scroll");
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
