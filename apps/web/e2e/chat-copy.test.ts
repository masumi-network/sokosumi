import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import {
  type Browser,
  chromium,
  type Page,
  errors as playwrightErrors,
} from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

/**
 * A new user with a one-person organization creates a first channel and reads
 * chat in the app's own words: "Add everyone in Ada Test Studio (1 member)",
 * not "Add all 1 members". Both add-people steps, with the people list and
 * its long mailbox address, stay inside a phone-width dialog. People are
 * grouped as People, not Humans, and Catch up never says "room".
 */
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

/**
 * What sticks out of the open dialog: each element whose box passes the
 * dialog's edge, and whether the dialog itself scrolls sideways.
 */
function dialogOverflow(page: Page) {
  return page.getByRole("dialog").evaluate((dialog) => {
    const edge = dialog.getBoundingClientRect();
    const outside = [...dialog.querySelectorAll("*")]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return (
          box.width > 0 &&
          (box.left < edge.left - 1 || box.right > edge.right + 1)
        );
      })
      .map((el) => (el.textContent ?? el.tagName).trim().slice(0, 40));
    return {
      outside,
      scrollsSideways: dialog.scrollWidth > dialog.clientWidth + 1,
    };
  });
}

/** Bring the chat list into view: the Chats tab on a phone, the sidebar's Chats panel above. */
async function showChatList(page: Page, name: string) {
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  const catchUp = page.getByRole("link", { name: "Catch up" }).first();
  if (name === "phone") {
    // Right after sign-up the page may still hydrate and drop the first tap,
    // so a tap that times out is tried again; any other failure is not.
    let lastError: unknown;
    for (let tap = 0; tap < 3; tap++) {
      if (await catchUp.isVisible()) return;
      try {
        await nav.getByRole("link", { name: "Chats" }).click();
        await catchUp.waitFor({ timeout: 10_000 });
        return;
      } catch (error) {
        if (!(error instanceof playwrightErrors.TimeoutError)) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }
  if (await catchUp.isVisible()) return;
  const showSidebar = page.getByRole("button", { name: "Show sidebar" });
  if (await showSidebar.isVisible()) await showSidebar.click();
  // At 768 the sidebar can open on another panel; the rail's Chats shows the list.
  if (
    !(await catchUp.waitFor({ timeout: 2_000 }).then(
      () => true,
      () => false,
    ))
  ) {
    await nav.getByRole("button", { name: /^Chats/ }).click();
  }
  await catchUp.waitFor();
}

for (const { name, isMobile, ...viewport } of PROJECTS) {
  describe(name, () => {
    let browser: Browser;
    before(async () => {
      mkdirSync(RESULTS_DIR, { recursive: true });
      browser = await chromium.launch();
    });
    after(() => browser.close());

    test("first channel and Catch up say chat, people and 1 member", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await signUpWithOrganization(page, BASE_URL);
      await showChatList(page, name);
      // The chat list redraws once rooms load; a tap before that can be lost.
      await page.getByText("No direct messages yet.").waitFor();

      // New direct message: people are People.
      await page
        .getByRole("button", { name: /^(Start a message|New direct message)$/ })
        .first()
        .click();
      const picker = page.getByRole("dialog", { name: "New direct message" });
      await picker.getByText("Message yourself").waitFor();
      const pickerText = await picker.innerText();
      await page.keyboard.press("Escape");
      await picker.waitFor({ state: "detached" });
      if (name !== "phone") await showChatList(page, name);

      // First channel: one member, in the singular, fitting the dialog.
      await page.getByRole("button", { name: "Create channel" }).click();
      await page
        .getByRole("textbox", { name: "Handle" })
        .pressSequentially("launch-plans", { delay: 30 });
      await page.getByRole("button", { name: "Next" }).click();
      const addEveryone = "Add everyone in Ada Test Studio (1\u00a0member)";
      await page.getByText(addEveryone, { exact: true }).waitFor();
      const addEveryoneFit = await dialogOverflow(page);
      const addPeopleText = await page.getByRole("dialog").innerText();
      await page.screenshot({
        path: `${RESULTS_DIR}${name}-chat-copy-add.png`,
      });
      // The people list holds the user's own long mailbox address.
      await page.getByRole("radio", { name: "Add specific people" }).click();
      await page.getByText("1 selected").waitFor();
      const specificFit = await dialogOverflow(page);
      const specificText = await page.getByRole("dialog").innerText();
      await page.screenshot({
        path: `${RESULTS_DIR}${name}-chat-copy-specific.png`,
      });
      await page.getByRole("radio", { name: addEveryone }).click();
      await page.getByRole("button", { name: "Create" }).click();
      await page.waitForURL(/\/chat\/rooms\//);

      // The tag note ("Everyone in this chat sees your change.") needs a
      // classifier tag, which can take a minute; src/app/(app)/chat/chat-copy.test.ts pins it.

      // Catch up, reached the way a reader would.
      if (name === "phone") {
        await page.getByRole("link", { name: "Back to chats" }).click();
        await page.waitForURL(/\/chat(\/rooms)?$/);
      }
      await showChatList(page, name);
      await page.getByRole("link", { name: "Catch up" }).first().click();
      await page.waitForURL(/\/chat\/catch-up$/);
      await page
        .getByText(
          /Nothing new needs you since you last read your chats\.|unread messages? in \d+ chats?/,
        )
        .first()
        .waitFor({ timeout: 45_000 });
      const catchUpText = await page.getByRole("main").innerText();
      await page.screenshot({
        path: `${RESULTS_DIR}${name}-chat-copy-catch-up.png`,
      });
      await context.close();

      assert.match(pickerText, /\bPeople\b/);
      assert.doesNotMatch(pickerText, /Humans/);
      assert.doesNotMatch(addPeopleText, /Add all 1 members/);
      assert.deepEqual(
        addEveryoneFit,
        { outside: [], scrollsSideways: false },
        "add-everyone step fits the dialog",
      );
      assert.deepEqual(
        specificFit,
        { outside: [], scrollsSideways: false },
        "specific-people step fits the dialog",
      );
      assert.match(specificText, /\bPeople\b/);
      assert.doesNotMatch(specificText, /Humans/);
      assert.doesNotMatch(catchUpText, /\brooms?\b/i);
      assert.deepEqual(errors, []);
    });
  });
}
