import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

/**
 * The chat list keeps the first tap. A new user opens Create channel as soon
 * as the list takes taps, and the dialog must still be open once the list has
 * settled: the phone's Chats page once replaced its list when the archived
 * rooms arrived, which closed the dialog. Repeated, because that was a race.
 */
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const ROUNDS = 3;

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

    test("a dialog opened from the chat list stays open while the list loads", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await signUpWithOrganization(page, BASE_URL);
      const nav = page.getByRole("navigation", { name: "Main navigation" });
      const showSidebar = page.getByRole("button", { name: "Show sidebar" });
      const dialog = page.getByRole("dialog", { name: "Create a channel" });
      const closed: number[] = [];

      for (let round = 1; round <= ROUNDS; round++) {
        if (name === "phone") {
          await nav.getByRole("link", { name: "Home" }).click();
          await page.waitForURL(`${BASE_URL}/`);
          await nav.getByRole("link", { name: "Chats" }).click();
        } else {
          await page.goto(BASE_URL);
          // The tablet layout keeps the sidebar behind a toggle.
          if (name === "tablet") await showSidebar.click();
        }
        // Playwright clicks once the button takes taps, the earliest a person can.
        await page.getByRole("button", { name: "Create channel" }).click();
        await dialog.waitFor();
        await page.waitForTimeout(3000);
        if (!(await dialog.isVisible())) closed.push(round);
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
      }

      await page.screenshot({
        path: `${RESULTS_DIR}${name}-chat-list-first-tap.png`,
      });
      await context.close();

      assert.deepEqual(closed, [], "Create a channel closed while loading");
      assert.deepEqual(errors, []);
    });
  });
}
