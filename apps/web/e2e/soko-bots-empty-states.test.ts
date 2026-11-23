import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

/**
 * A brand-new organization's Soko Bots: the team section says nobody else is
 * here and links to the invites; a new shared bot's switched-off schedules
 * read "Off"; an archived shared bot offers a translated Reactivate.
 */
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function openSokoBots(page: Page, name: string) {
  if (name === "phone") {
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Chats" })
      .click();
  }
  // The tablet layout keeps the sidebar behind a toggle.
  const showSidebar = page.getByRole("button", { name: "Show sidebar" });
  if (name === "tablet" && (await showSidebar.isVisible())) {
    await showSidebar.click();
  }
  await page.getByRole("link", { name: "Soko Bots" }).first().click();
  await page.waitForURL(`${BASE_URL}/soko-bots`);
}

for (const { name, isMobile, ...viewport } of PROJECTS) {
  describe(name, () => {
    let browser: Browser;
    before(async () => {
      mkdirSync(RESULTS_DIR, { recursive: true });
      browser = await chromium.launch();
    });
    after(() => browser.close());

    test("new organization sees helpful empty states on Soko Bots", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await signUpWithOrganization(page, BASE_URL);
      await openSokoBots(page, name);

      const invite = page.getByRole("link", { name: "Invite your team" });
      await invite.waitFor();
      assert.equal(await invite.getAttribute("href"), "/organization");

      await page.getByRole("button", { name: "New Soko Bot" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill("Studio Desk");
      await page.getByRole("button", { name: "Create" }).click();
      await page.waitForURL(/\/soko-bots\/[^/]+$/);
      await page.getByRole("heading", { name: "Schedules" }).waitFor();
      const nextDisabled = await page.getByText("Next disabled").count();
      const off = await page.getByText("Off", { exact: true }).count();

      await page.getByRole("switch", { name: "Advanced" }).click();
      await page.getByRole("button", { name: "Archive" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Archive" })
        .click();
      await page.waitForURL(`${BASE_URL}/soko-bots`);
      await page
        .getByRole("link", { name: /^Studio Desk/ })
        .first()
        .click();
      await page
        .getByRole("heading", { name: "Studio Desk is archived" })
        .waitFor();
      const reactivate = page.getByRole("button", { name: "Reactivate" });
      await reactivate.waitFor();
      const rawKeys = await page.getByText("App.SokoBots").count();
      await page.screenshot({
        path: `${RESULTS_DIR}${name}-soko-bots-archived.png`,
      });
      await reactivate.click();
      await page.getByText("Soko Bot reactivated.").waitFor();
      await context.close();

      assert.equal(nextDisabled, 0, '"Next disabled" on a schedule');
      assert.ok(off > 0, '"Off" on the switched-off schedules');
      assert.equal(rawKeys, 0, "untranslated App.SokoBots key on the page");
      assert.deepEqual(errors, []);
    });
  });
}
