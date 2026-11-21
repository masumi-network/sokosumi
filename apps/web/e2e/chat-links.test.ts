import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

/**
 * A new user posts two links in a new channel, opens the room's Links list,
 * finds both newest first, and jumps from one back to its message.
 */
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

const PLAN = "https://example.com/launch-plan";
const BRIEF = "https://docs.example.org/brief";

for (const { name, isMobile, ...viewport } of PROJECTS) {
  describe(name, () => {
    let browser: Browser;
    before(async () => {
      mkdirSync(RESULTS_DIR, { recursive: true });
      browser = await chromium.launch();
    });
    after(() => browser.close());

    test("new user finds the links posted in a channel", async () => {
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
      if (name === "tablet") {
        await page.getByRole("button", { name: "Show sidebar" }).click();
      }
      await page.getByText("No direct messages yet.").waitFor();
      await page.getByRole("link", { name: "Catch up" }).first().click();
      await page.getByRole("button", { name: "Create a channel" }).click();
      await page
        .getByRole("textbox", { name: "Handle" })
        .pressSequentially("launch-links", { delay: 30 });
      await page.getByRole("button", { name: "Next" }).click();
      await page.getByRole("button", { name: "Create" }).click();
      await page.waitForURL(/\/chat\/rooms\//);

      const composer = page.getByRole("textbox", {
        name: "Message #Launch Links",
      });
      for (const text of [`Plan is here: ${PLAN}`, `Brief: ${BRIEF}`]) {
        await composer.fill(text);
        await page.getByRole("button", { name: "Send message" }).click();
        await page.getByText(text).last().waitFor();
      }

      if (name === "phone") {
        await page.getByRole("button", { name: "More chat options" }).click();
        await page.getByRole("menuitem", { name: "Links" }).click();
      } else {
        await page.getByRole("button", { name: "Links", exact: true }).click();
      }
      const panel = page.getByTestId("room-links-panel");
      await panel.getByRole("link").first().waitFor();
      const hrefs = await panel
        .getByRole("link")
        .evaluateAll((links) => links.map((l) => l.getAttribute("href")));
      await page.screenshot({ path: `${RESULTS_DIR}${name}-chat-links.png` });

      await panel
        .getByRole("button", { name: "Show the message with example.com" })
        .click();
      await panel.waitFor({ state: "detached" });
      await context.close();

      assert.deepEqual(hrefs, [BRIEF, PLAN]);
      assert.deepEqual(errors, []);
    });
  });
}
