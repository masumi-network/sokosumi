import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

/**
 * A new owner whose Organization has a DESIGN.md (generated from example.com
 * at setup) creates a Project with no website and starts its brand from the
 * Organization's: Copy <Organization> brand from the keyboard, and the Project's
 * brand reads Ready, focus lands on the brand menu, and its Design tab
 * shows the copied document.
 * Free only: setup's brand generation, a Project and a copy.
 */
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const ORGANIZATION = "Ada Test Studio";
const PROJECT = "E2E spring launch";

const SIZES = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function assertNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 1, `page is ${overflow}px wider than the screen`);
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
    test("a new Project starts its brand from the Organization's DESIGN.md", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await signUpWithOrganization(page, BASE_URL);

      // Setup generates the Organization's DESIGN.md in the background.
      await page.goto(`${BASE_URL}/organization`);
      const attached = page
        .getByText("DESIGN.md attached to this profile")
        .first();
      for (let attempt = 1; !(await attached.isVisible()); attempt++) {
        assert.ok(attempt <= 36, "DESIGN.md was not generated in 3 minutes");
        await page.waitForTimeout(5_000);
        await page.reload();
      }

      await page.goto(`${BASE_URL}/projects`);
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

      const use = page.getByRole("button", {
        name: `Copy ${ORGANIZATION} brand`,
      });
      await use.waitFor();
      await assertNoOverflow(page);
      await page.screenshot({
        path: `${RESULTS_DIR}project-brand-from-organization-${size}-offer.png`,
      });
      // From the keyboard: focus lands on the brand menu that replaces it.
      await use.focus();
      await page.keyboard.press("Enter");
      await page.getByText(`Copied the ${ORGANIZATION} brand`).waitFor();
      await page.getByText("Ready", { exact: true }).first().waitFor();
      assert.equal(await use.count(), 0, "the offer goes once a brand is set");
      assert.equal(
        await page.evaluate(() =>
          document.activeElement?.getAttribute("aria-label"),
        ),
        "Brand actions",
        "focus moves to the brand menu",
      );

      await page
        .getByRole("navigation", { name: "Project sections" })
        .getByRole("link", { name: "Design" })
        .click();
      await page.waitForURL(/\/design-md$/);
      await page.getByTestId("project-design-document").waitFor();
      await assertNoOverflow(page);
      await page.screenshot({
        path: `${RESULTS_DIR}project-brand-from-organization-${size}-design.png`,
      });

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
