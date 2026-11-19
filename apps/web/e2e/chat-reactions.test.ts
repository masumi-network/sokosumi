import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

/**
 * A new user reacts to their own message and starts a chat with themselves.
 * The Reaction chip is named by what it shows and reads as pressed, and
 * "Message yourself" shows the user's own initials (Ada Tester: AT).
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

    test("reaction chip says its count and state; self chat shows own initials", async () => {
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

      await page
        .getByRole("textbox", { name: "Message #Launch Plans" })
        .fill("Kickoff for the spring launch.");
      await page.getByRole("button", { name: "Send message" }).click();
      const message = page.getByRole("article").last();
      await message.getByText("Kickoff for the spring launch.").waitFor();
      if (isMobile) {
        // Touch has no hover pill. The row's always-mounted actions button
        // opens the same sheet a long press does; a held mouse click does
        // not stand in for a touch long press here.
        await message.getByRole("button", { name: "Message actions" }).focus();
        await page.keyboard.press("Enter");
      } else {
        await message.hover();
      }
      // The reaction's Server Action carries the emoji in its body. Server
      // Actions run one at a time, so it can wait behind the room's own; a
      // reload before it answers would drop it unsent.
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          (response.request().postData() ?? "").includes("👍"),
      );
      await page.getByRole("button", { name: "React with 👍" }).first().click();
      const chip = page.getByRole("button", { name: "👍 1" });
      await chip.waitFor();
      const pressed = await chip.getAttribute("aria-pressed");
      await saved;
      // The saved state, not the optimistic one: a rolled-back reaction
      // would be gone (or unpressed) after a reload.
      await page.reload();
      const reloadedChip = page.getByRole("button", { name: "👍 1" });
      await reloadedChip.waitFor();
      const pressedAfterReload =
        await reloadedChip.getAttribute("aria-pressed");

      if (name === "phone") {
        await page.getByRole("link", { name: "Back to chats" }).click();
        await page.waitForURL(`${BASE_URL}/chat`);
      }
      if (name === "tablet" && (await showSidebar.isVisible())) {
        await showSidebar.click();
      }
      await page.getByRole("button", { name: "New direct message" }).click();
      const self = page.getByRole("button", { name: /Message yourself/ });
      await self.waitFor();
      const selfText = (await self.textContent()) ?? "";
      await page.screenshot({
        path: `${RESULTS_DIR}${name}-chat-reactions.png`,
      });
      await context.close();

      assert.equal(pressed, "true", "own reaction chip is pressed");
      assert.equal(
        pressedAfterReload,
        "true",
        "own reaction chip is still pressed after a reload",
      );
      assert.match(selfText, /^AT/, "Message yourself shows AT");
      assert.deepEqual(errors, []);
    });
  });
}
