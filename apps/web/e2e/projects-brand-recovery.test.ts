import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user's first Project gets a website brand generation cannot reach.
// The Brand card says Failed, why and when, and keeps the website in a field
// marked invalid, all still there after a reload, so the user corrects it in
// place and the DESIGN.md comes out Ready. Each size signs up its own disposable mail.tm inbox. Brand generation
// is free for the user.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const PROJECT = "E2E brand recovery";
// `.invalid` never resolves (RFC 2606), so generation fails the same way
// every run.
const BAD_WEBSITE = "e2e-bakery.invalid";
const GOOD_WEBSITE = "example.com";

const SIZES = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}projects-brand-${size}-${step}.png`,
  });
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
    test("a new user fixes a website brand generation could not reach", async () => {
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

      const brand = page.getByTestId("project-brand-card");
      await brand
        .getByLabel("Add a project website before generating brand context.")
        .fill(BAD_WEBSITE);
      await brand
        .getByRole("button", { name: "Generate from website" })
        .click();

      // Failed: the reason shows, and the saved website stays editable.
      await brand.getByRole("alert").waitFor({ timeout: 90_000 });
      const website = brand.getByRole("textbox", { name: "Project website" });
      assert.equal(await website.inputValue(), `https://${BAD_WEBSITE}/`);
      await shot(page, size, "failed");

      // Back later, the failure and the website to fix are both still there.
      await page.reload();
      // Restored, so shown and described but not announced again.
      await brand.getByText("Failed", { exact: true }).waitFor();
      await brand.getByText(`from ${BAD_WEBSITE}.`, { exact: false }).waitFor();
      await brand.getByText(/^Last tried /).waitFor();
      assert.equal(await brand.getByRole("alert").count(), 0);
      assert.equal(await website.inputValue(), `https://${BAD_WEBSITE}/`);
      assert.equal(await website.getAttribute("aria-invalid"), "true");
      assert.ok(
        (await website.getAttribute("aria-describedby"))?.includes(
          "project-brand-failure",
        ),
      );

      await website.fill(GOOD_WEBSITE);
      await website.press("Enter");
      await brand.getByText("Ready").waitFor({ timeout: 120_000 });
      await shot(page, size, "ready");

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      assert.equal(overflow, false, "no sideways page scroll");
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
