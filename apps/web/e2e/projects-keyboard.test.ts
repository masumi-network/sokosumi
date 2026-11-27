import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A keyboard user's Project: the wizard announces how the brand went, every
// project page has its own title, and following a project tab, going Back
// or closing Edit leaves focus on the current tab instead of the page body.
// Each size signs up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const PROJECT = "E2E keyboard launch";

const SIZES = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}projects-keyboard-${size}-${step}.png`,
  });
}

/** The focused control's name, or "body" when focus fell to the page. */
function focused(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    return !active || active === document.body
      ? "body"
      : (active.textContent ?? "").trim();
  });
}

async function waitForFocus(page: Page, name: string) {
  await page.waitForFunction(
    (expected) =>
      (document.activeElement?.textContent ?? "").trim() === expected,
    name,
  );
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
    test("project pages keep keyboard focus and name themselves", async () => {
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

      // The wizard by keyboard: type, Tab, Enter.
      await page.goto(`${BASE_URL}/projects`);
      await page.getByRole("heading", { name: "No projects yet" }).waitFor();
      await page
        .getByRole("button", { name: /^(New project|Create project)$/ })
        .filter({ visible: true })
        .first()
        .click();
      const wizard = page.getByRole("dialog", { name: "New project" });
      await wizard.getByLabel("Project name").fill(PROJECT);
      await page.keyboard.press("Tab");
      await page.keyboard.type("example.com");
      await wizard.getByRole("button", { name: "Continue" }).focus();
      await page.keyboard.press("Enter");
      await wizard.getByRole("button", { name: "Continue" }).focus();
      await page.keyboard.press("Enter");
      await wizard.getByRole("button", { name: "Create project" }).focus();
      await page.keyboard.press("Enter");

      // Focus moves to Open project at once, so the brand line is a live
      // region and its result is read out when it changes.
      const status = wizard.getByRole("status");
      await status
        .filter({ hasText: /Brand is ready|couldn't finish/ })
        .waitFor({ timeout: 120_000 });
      await shot(page, size, "brand-status");
      await wizard.getByRole("button", { name: "Open project" }).focus();
      await page.keyboard.press("Enter");
      await page.waitForURL(/\/projects\/[^/?]+$/);
      await page.getByRole("heading", { level: 1, name: PROJECT }).waitFor();
      const overviewUrl = page.url();
      await waitForFocus(page, "Overview");
      await page.waitForFunction(
        (name) => document.title.endsWith(name),
        PROJECT,
      );

      // Following a tab with Enter keeps focus on the new current tab, and
      // the page's title names the section and the project.
      await page.keyboard.press("Tab");
      assert.equal(await focused(page), "Design");
      await page.keyboard.press("Enter");
      await page.waitForURL(/\/design-md$/);
      await waitForFocus(page, "Design");
      await page.waitForFunction(
        (name) => document.title.endsWith(`Design · ${name}`),
        PROJECT,
      );
      await shot(page, size, "design-tab-focus");

      // Back shows the Overview Next kept: focus comes back to its tab.
      await page.goBack();
      await page.waitForURL(overviewUrl);
      await waitForFocus(page, "Overview");
      await page.waitForFunction(
        (name) =>
          document.title.endsWith(name) && !document.title.includes("·"),
        PROJECT,
      );

      // Closing Edit with Escape returns to the current tab, not the body.
      await page
        .getByRole("button", { name: "More actions" })
        .filter({ visible: true })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Edit" }).click();
      await page.getByRole("dialog", { name: "Edit project" }).waitFor();
      await page.keyboard.press("Escape");
      await page.waitForURL(overviewUrl);
      await waitForFocus(page, "Overview");
      await shot(page, size, "edit-closed-focus");

      // A fresh load leaves focus where the browser puts it.
      await page.reload();
      await page.getByRole("heading", { level: 1, name: PROJECT }).waitFor();
      assert.equal(await focused(page), "body");

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      assert.equal(overflow, false, "no sideways page scroll");
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
