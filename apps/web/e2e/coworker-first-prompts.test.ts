import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

/**
 * A new user opens a first chat with the Coworker Hannah. The empty chat
 * offers Hannah's example requests; a tap adds one to the draft after what
 * the user typed, and nothing is sent.
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

    test("an empty Coworker chat offers example requests that fill the draft", async () => {
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
      // The chat list redraws once rooms load; a tap before that can be lost.
      await page.getByText("No direct messages yet.").waitFor();
      await page.getByRole("button", { name: "New direct message" }).click();
      await page
        .getByRole("button", { name: /^(HA )?Hannah AI coworker/ })
        .click();
      await page.getByRole("button", { name: "Create" }).click();
      await page.waitForURL(/\/chat\/rooms\//);

      const prompts = page.getByRole("list", { name: "Try asking Hannah" });
      await prompts.waitFor();
      const firstPrompt = prompts.getByRole("button").first();
      const composer = page.getByRole("textbox", { name: "Message Hannah" });
      await composer.click();
      await composer.pressSequentially("Hi", { delay: 30 });
      await firstPrompt.click();

      const draft = (await composer.innerText()).trim();
      await page.screenshot({
        path: `${RESULTS_DIR}${name}-coworker-first-prompts.png`,
      });
      const stillEmpty = await page.getByText("No messages yet").count();
      await context.close();

      assert.ok(draft.startsWith("Hi "), `draft kept: ${draft}`);
      assert.ok(draft.length > "Hi ".length + 10, "prompt added to the draft");
      assert.equal(stillEmpty, 1, "nothing was sent");
      assert.deepEqual(errors, []);
    });
  });
}
