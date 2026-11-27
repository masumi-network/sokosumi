import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

/**
 * A brand-new user's first chat: sign up with a disposable mail.tm inbox,
 * create an Organization, start an External channel from the first Catch up
 * and post in it. Then the chat list must not claim "No channels yet." beside
 * that channel.
 */
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

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

    test("new user starts an External channel from Catch up and posts in it", async () => {
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
      // The tablet layout keeps the sidebar behind a toggle.
      const showSidebar = page.getByRole("button", { name: "Show sidebar" });
      if (name === "tablet") await showSidebar.click();
      // The chat list redraws once rooms load; a tap before that can be lost.
      await page.getByText("No direct messages yet.").waitFor();
      // A first Catch up says what it is for and starts the first channel.
      await page.getByRole("link", { name: "Catch up" }).first().click();
      await page.getByText("Nothing to catch up on yet").waitFor();
      const caughtUp = await page.getByText("You're caught up").count();
      // Nobody else is in this new organization, so there is no one to message.
      const messageTeammate = await page
        .getByRole("button", { name: "Message a teammate" })
        .count();
      await page.getByRole("button", { name: "Create a channel" }).click();
      // Typed, not filled: the name drives the link and an availability check.
      await page
        .getByRole("textbox", { name: "Name" })
        .pressSequentially("Launch Plans", { delay: 30 });
      await page.getByRole("radio", { name: "External" }).click();
      await page.getByRole("button", { name: "Next" }).click();
      await page.getByRole("button", { name: "Create" }).click();
      await page.waitForURL(/\/chat\/rooms\//);

      const composer = page.getByRole("textbox", {
        name: "Message #Launch Plans",
      });
      await composer.fill("Kickoff notes for the spring launch go here.");
      await page.getByRole("button", { name: "Send message" }).click();
      await page
        .getByText("Kickoff notes for the spring launch go here.")
        .last()
        .waitFor();

      if (name === "phone") {
        await page.getByRole("link", { name: "Back to chats" }).click();
        await page.waitForURL(`${BASE_URL}/chat`);
      }
      if (name === "tablet" && (await showSidebar.isVisible())) {
        await showSidebar.click();
      }
      await page.getByRole("link", { name: "Launch Plans" }).first().waitFor();
      await page.screenshot({
        path: `${RESULTS_DIR}${name}-chat-new-user.png`,
      });
      const noChannels = await page.getByText("No channels yet.").count();
      await context.close();

      assert.equal(caughtUp, 0, '"You\'re caught up" before any room');
      assert.equal(messageTeammate, 0, "Message a teammate with no teammates");
      assert.equal(noChannels, 0, '"No channels yet." beside the new channel');
      assert.deepEqual(errors, []);
    });
  });
}
