import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

/**
 * A new user opens a new channel's Decisions log (on the phone from the
 * header's More chat options menu, by touch and by mouse) and then Catch up's
 * Decisions tab. The log stays open and, with no decisions, carries no note on
 * fixing one. Catch up's tabs stay on screen while the Decisions tab loads.
 */
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const FIX_NOTE = /If one is wrong/;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

for (const { name, isMobile, ...viewport } of PROJECTS) {
  describe(name, () => {
    let browser: Browser;
    before(async () => {
      mkdirSync(RESULTS_DIR, { recursive: true });
      browser = await chromium.launch();
    });
    after(() => browser.close());

    test("decisions log opens and stays without a fix note; Catch up tabs stay while a tab loads", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await signUpWithOrganization(page, BASE_URL);
      if (name === "phone") {
        await page
          .getByRole("navigation", { name: "Main navigation" })
          .getByRole("link", { name: "Chats" })
          .click();
      }
      const showSidebar = page.getByRole("button", { name: "Show sidebar" });
      if (name === "tablet") await showSidebar.click();
      // The chat list redraws once rooms load; a tap before that can be lost.
      await page.getByText("No direct messages yet.").waitFor();
      await page.getByRole("button", { name: "Create channel" }).click();
      await page
        .getByRole("textbox", { name: "Name" })
        .pressSequentially("Launch Plans", { delay: 30 });
      await page.getByRole("button", { name: "Next" }).click();
      await page.getByRole("button", { name: "Create" }).click();
      await page.waitForURL(/\/chat\/rooms\//);
      await page.getByText("No messages yet").waitFor();

      const log = page.getByTestId("room-decisions-panel");
      // A log that closes on its own does so a moment after opening.
      async function logStaysOpen() {
        // A log that closed already never shows its text: report, not hang.
        await log
          .getByText("No decisions here yet.", { exact: false })
          .waitFor({ timeout: 5000 })
          .catch(() => undefined);
        await page.waitForTimeout(800);
        return log.isVisible();
      }
      const menu = page.getByRole("button", { name: "More chat options" });
      const menuItem = page.getByRole("menuitem", { name: "Decisions" });
      let logOpenByTouch = true;
      if (name === "phone") {
        await menu.tap();
        await menuItem.tap();
        logOpenByTouch = await logStaysOpen();
        await page.keyboard.press("Escape");
        await log.waitFor({ state: "detached" });
        // A mouse leaving the picked item used to hand focus back to the
        // closing menu, which closed the log (a narrow window, a trackpad).
        await menu.click();
        await menuItem.click();
      } else {
        await page.getByRole("button", { name: "Decisions" }).click();
      }
      const logOpenByMouse = await logStaysOpen();
      const logNote = await log.getByText(FIX_NOTE).count();
      await page.screenshot({
        path: `${RESULTS_DIR}${name}-room-decisions.png`,
      });
      await page.keyboard.press("Escape");

      if (name === "phone") {
        await page.getByRole("link", { name: "Back to chats" }).click();
        await page.waitForURL(`${BASE_URL}/chat`);
      }
      if (name === "tablet" && (await showSidebar.isVisible())) {
        await showSidebar.click();
      }
      await page.getByRole("link", { name: "Catch up" }).click();
      const tabs = page.getByRole("navigation", { name: "Catch up sections" });
      await tabs.waitFor();
      await tabs.getByRole("link", { name: "Saved" }).click();
      await page.waitForURL(/\/chat\/catch-up\/saved$/);
      await page.getByText("Nothing saved yet").waitFor();

      // Hold the Decisions page's navigation read (not its prefetch) so the
      // tab's loading shell stays up long enough to look at.
      const { promise: held, resolve: release } = Promise.withResolvers<void>();
      await page.route(/\/chat\/catch-up\/decisions\?_rsc=/, async (route) => {
        const headers = route.request().headers();
        if (!headers["next-router-prefetch"]) await held;
        await route.continue();
      });
      await tabs.getByRole("link", { name: "Decisions" }).click();
      const loading = page.getByTestId("chat-unread-view-loading");
      await loading.waitFor();
      const tabsWhileLoading = await tabs.isVisible();
      release();
      await page.waitForURL(/\/chat\/catch-up\/decisions$/);
      await page.getByTestId("decisions-empty").waitFor();
      await loading.waitFor({ state: "detached" });
      const pageNote = await page.getByText(FIX_NOTE).count();
      const current = await tabs
        .getByRole("link", { name: "Decisions" })
        .getAttribute("aria-current");
      await page.screenshot({
        path: `${RESULTS_DIR}${name}-catch-up-decisions.png`,
      });
      await context.close();

      assert.deepEqual(
        {
          logOpenByTouch,
          logOpenByMouse,
          logNote,
          tabsWhileLoading,
          current,
          pageNote,
        },
        {
          logOpenByTouch: true,
          logOpenByMouse: true,
          logNote: 0,
          tabsWhileLoading: true,
          current: "page",
          pageNote: 0,
        },
      );
      assert.deepEqual(errors, []);
    });
  });
}
