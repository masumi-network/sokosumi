import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

/**
 * A brand-new organization's Competitors, reached from the sidebar or, on a
 * phone, from the You page: the page asks for a project and
 * creates one in place, then a competitor added by hand shows under
 * Watching with the weekly check off and its price, an edit shows its
 * Instagram, and removing it brings back the start. Nothing is paid.
 */
const BASE_URL = resolveBaseUrl(process.env);

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function openCompetitors(page: Page, name: string) {
  // Phones have no sidebar: the You page is their menu.
  if (name === "phone") {
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "You" })
      .click();
  }
  // The tablet layout keeps the sidebar behind a toggle.
  const showSidebar = page.getByRole("button", { name: "Show sidebar" });
  if (name === "tablet" && (await showSidebar.isVisible())) {
    await showSidebar.click();
  }
  await page.getByRole("link", { name: "Competitors" }).first().click();
  await page.waitForURL(`${BASE_URL}/competitors`);
}

for (const { name, isMobile, ...viewport } of PROJECTS) {
  describe(name, () => {
    let browser: Browser;
    before(async () => {
      browser = await chromium.launch();
    });
    after(() => browser.close());

    test("new organization watches a competitor it added by hand", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await signUpWithOrganization(page, BASE_URL);
      await openCompetitors(page, name);

      await page.getByRole("heading", { name: "Pick a project" }).waitFor();
      await page.getByRole("button", { name: "Create project" }).click();
      await page
        .getByRole("textbox", { name: "Project name" })
        .fill("Coffee Launch");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("textbox", { name: "Briefing" }).fill("Beans.");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Create project" }).click();

      const start = page.getByRole("heading", {
        name: "See what your competitors changed this week",
      });
      // With a website the dialog stays open while it fetches the brand.
      const open = page.getByRole("button", { name: "Open project" });
      await start.or(open).first().waitFor();
      if (await open.isVisible()) await open.click();
      await start.waitFor();
      // Opened from You, the page goes back to You, project picked or not.
      if (name === "phone") {
        await page.getByRole("link", { name: "Back to You" }).waitFor();
      }
      await page.getByRole("button", { name: "Add by hand" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill("Acme Roasters");
      await page
        .getByRole("textbox", { name: "Website" })
        .fill("acme-roasters.example");
      await page.getByRole("button", { name: "Add", exact: true }).click();

      const watching = page.getByRole("region", { name: "Watching" });
      await watching.getByText("1 of 5").waitFor();
      await page
        .getByRole("heading", { name: "The weekly check is off" })
        .waitFor();
      assert.ok(
        await page
          .getByText("It costs 3 credits a week for 1 competitor.")
          .isVisible(),
      );

      await page.getByRole("button", { name: "Edit Acme Roasters" }).click();
      await page.getByRole("textbox", { name: "Instagram" }).fill("acme");
      await page.getByRole("button", { name: "Save" }).click();
      await watching.getByText("@acme").waitFor();

      await page.getByRole("button", { name: "Remove Acme Roasters" }).click();
      await start.waitFor();

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
