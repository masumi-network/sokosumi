import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

/**
 * A new user opens a new channel's Decisions log (on the phone from the
 * header's More chat options menu, by tap) and then Catch up's Decisions tab.
 * The log stays open and, with no decisions, carries no note on fixing one.
 * Catch up's tabs stay on screen while the Decisions tab loads.
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

    test("decisions log opens by tap without a fix note; Catch up tabs stay while a tab loads", async () => {
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
        .getByRole("textbox", { name: "Handle" })
        .pressSequentially("launch-plans", { delay: 30 });
      await page.getByRole("button", { name: "Next" }).click();
      await page.getByRole("button", { name: "Create" }).click();
      await page.waitForURL(/\/chat\/rooms\//);
      await page.getByText("No messages yet").waitFor();

      if (name === "phone") {
        await page.getByRole("button", { name: "More chat options" }).tap();
        await page.getByRole("menuitem", { name: "Decisions" }).tap();
      } else {
        await page.getByRole("button", { name: "Decisions" }).click();
      }
      const log = page.getByTestId("room-decisions-panel");
      await log.getByText("No decisions here yet.", { exact: false }).waitFor();
      // A log that closes on its own does so a moment after opening.
      await page.waitForTimeout(800);
      const logOpen = await log.isVisible();
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

      // Watch the tabs while the Decisions tab loads: they never leave.
      await page.evaluate(() => {
        const w = window as unknown as { tabsGone: boolean };
        w.tabsGone = false;
        const nav = () =>
          document.querySelector('nav[aria-label="Catch up sections"]');
        new MutationObserver(() => {
          if (!nav()) w.tabsGone = true;
        }).observe(document.body, { childList: true, subtree: true });
      });
      await tabs.getByRole("link", { name: "Decisions" }).click();
      await page.waitForURL(/\/chat\/catch-up\/decisions$/);
      await page.getByTestId("decisions-empty").waitFor();
      const tabsGone = await page.evaluate(
        () => (window as unknown as { tabsGone: boolean }).tabsGone,
      );
      const pageNote = await page.getByText(FIX_NOTE).count();
      const current = await tabs
        .getByRole("link", { name: "Decisions" })
        .getAttribute("aria-current");
      await page.screenshot({
        path: `${RESULTS_DIR}${name}-catch-up-decisions.png`,
      });
      await context.close();

      assert.equal(logOpen, true, "decisions log stays open");
      assert.equal(logNote, 0, "empty log has no fix note");
      assert.equal(tabsGone, false, "Catch up tabs stay while a tab loads");
      assert.equal(current, "page", "Decisions tab is current");
      assert.equal(pageNote, 0, "empty Decisions tab has no fix note");
      assert.deepEqual(errors, []);
    });
  });
}
