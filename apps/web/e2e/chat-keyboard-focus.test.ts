import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

/**
 * A new keyboard user in a channel: the room name is the page's h1, tabbing
 * onto a message's screen-reader-only actions button marks its row, and
 * closing a thread puts focus back where it was opened from (the message's
 * actions button while the thread has no replies, its "1 reply" bar after),
 * with the bar's ring whole inside the message column. Escape closes the
 * thread from inside it and puts focus back on the same place, and closes
 * Threads straight after opening it, focus still on its button. A heading
 * written in a message keeps its look but stays out of the page's headings.
 * Message yourself is headed "Ada Tester (you)", without the avatar's
 * initials.
 */
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

/** What has focus, as a user and a screen reader would name it. */
function focused(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const row = active?.closest("article");
    let clip = active?.parentElement ?? null;
    while (clip && getComputedStyle(clip).overflowX !== "clip") {
      clip = clip.parentElement;
    }
    const box = active?.getBoundingClientRect();
    const clipBox = clip?.getBoundingClientRect();
    return {
      name: active?.getAttribute("aria-label") ?? active?.textContent ?? "",
      focusVisible: active?.matches(":focus-visible") ?? false,
      rowText: row?.textContent ?? "",
      rowMarked: row ? getComputedStyle(row).boxShadow.includes("rgb") : false,
      // A 2px ring needs 2px of room inside the column's clip.
      ringInsideClip:
        box && clipBox
          ? box.left - 2 >= clipBox.left && box.right + 2 <= clipBox.right
          : null,
    };
  });
}

async function send(page: Page, text: string, shownAs = text) {
  await page.getByRole("textbox", { name: "Message #Launch Plans" }).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
  // Sent, not just drawn: an optimistic row has no actions button yet.
  await page
    .getByRole("article")
    .filter({ hasText: shownAs })
    .getByRole("button", { name: "Message actions" })
    .waitFor({ state: "attached" });
}

/** From the composer, Shift+Tab onto the last message's actions button. */
async function tabToLastMessageActions(page: Page) {
  await page.getByRole("textbox", { name: "Message #Launch Plans" }).click();
  await page.keyboard.press("Shift+Tab");
}

async function openThreadFromActions(page: Page) {
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Message actions" });
  await sheet.getByRole("button", { name: "Open thread" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Close thread" }).waitFor();
}

/** Close from inside the thread: its X with Enter, or Escape. */
async function closeThread(page: Page, key: "Enter" | "Escape" = "Enter") {
  await page.getByRole("button", { name: "Close thread" }).focus();
  await page.keyboard.press(key);
  await page.getByRole("button", { name: "Close thread" }).waitFor({
    state: "detached",
  });
  // Focus moves a frame after the pane unmounts.
  await page.waitForTimeout(300);
}

for (const { name, isMobile, ...viewport } of PROJECTS) {
  describe(name, () => {
    let browser: Browser;
    before(async () => {
      mkdirSync(RESULTS_DIR, { recursive: true });
      browser = await chromium.launch();
    });
    after(() => browser.close());

    test("room heading, visible row focus and focus kept when a thread closes", async () => {
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

      const roomHeading = page.getByRole("heading", {
        level: 1,
        name: "Launch Plans",
      });
      await roomHeading.waitFor();

      await send(page, "Can someone draft the announcement post by Friday?");
      await send(page, "### Next steps", "Next steps");
      const messageHeadings = {
        drawn: await page
          .locator("article h3", { hasText: "Next steps" })
          .count(),
        named: await page.getByRole("heading", { name: "Next steps" }).count(),
      };
      await send(page, "Checklist lives in the shared drive.");

      // A thread with no replies: focus goes back to the message's actions.
      await tabToLastMessageActions(page);
      const onActions = await focused(page);
      await openThreadFromActions(page);
      await closeThread(page);
      const afterEmptyThread = await focused(page);

      // Reply in the first message's thread, then close it.
      // Automatic tags can add stops between the rows, so walk back until
      // the first message's actions button has focus.
      await tabToLastMessageActions(page);
      for (let step = 0; step < 12; step++) {
        const now = await focused(page);
        if (
          now.name === "Message actions" &&
          /announcement post by Friday/.test(now.rowText)
        ) {
          break;
        }
        await page.keyboard.press("Shift+Tab");
      }
      await openThreadFromActions(page);
      await page
        .getByRole("textbox", { name: "Reply in thread" })
        .fill("I can take it.");
      // Enter adds a line on touch screens; the thread's own Send works on all.
      await page
        .getByRole("complementary")
        .filter({ has: page.getByRole("heading", { name: "Thread" }) })
        .getByRole("button", { name: "Send message" })
        .click();
      // On a phone or tablet the thread covers the room, so the bar is in
      // the page but not on screen until the thread closes.
      await page
        .getByRole("button", { name: "1 reply" })
        .waitFor({ state: "attached" });
      await closeThread(page, "Escape");
      const afterReply = await focused(page);

      // Threads, opened with Enter from the header (its menu below md), then
      // Escape at once: focus never moved into the pane.
      if (name === "phone") {
        await page.getByRole("button", { name: /^More chat options/ }).focus();
        await page.keyboard.press("Enter");
        await page.getByRole("menuitem", { name: "Threads" }).focus();
      } else {
        await page.getByRole("button", { name: /^Threads/ }).focus();
      }
      await page.keyboard.press("Enter");
      const closeThreads = page.getByRole("button", { name: "Close threads" });
      await closeThreads.waitFor();
      await page.waitForTimeout(300);
      await page.keyboard.press("Escape");
      await closeThreads.waitFor({ state: "detached" });
      await page.waitForTimeout(300);
      const afterThreads = await focused(page);
      await page.screenshot({
        path: `${RESULTS_DIR}${name}-chat-keyboard-focus.png`,
      });

      // Message yourself: its heading leaves the avatar's initials out.
      if (name === "phone") {
        await page.getByRole("link", { name: "Back to chats" }).click();
        await page.waitForURL(`${BASE_URL}/chat`);
      }
      if (name === "tablet" && (await showSidebar.isVisible())) {
        await showSidebar.click();
      }
      await page.getByRole("button", { name: "New direct message" }).click();
      await page.getByRole("button", { name: /Message yourself/ }).click();
      await page.getByRole("button", { name: "Create" }).click();
      const selfHeading = page.getByRole("heading", {
        level: 1,
        name: "Ada Tester (you)",
        exact: true,
      });
      await selfHeading.waitFor();
      await context.close();

      assert.equal(onActions.name, "Message actions");
      assert.equal(onActions.focusVisible, true);
      assert.match(onActions.rowText, /Checklist lives in the shared drive/);
      assert.equal(onActions.rowMarked, true, "focused row shows a ring");

      assert.equal(afterEmptyThread.name, "Message actions");
      assert.match(
        afterEmptyThread.rowText,
        /Checklist lives in the shared drive/,
      );

      assert.equal(afterReply.name, "1 reply");
      assert.equal(afterReply.focusVisible, true);
      assert.match(afterReply.rowText, /announcement post by Friday/);
      assert.equal(afterReply.ringInsideClip, true, "reply bar ring is whole");

      assert.match(
        afterThreads.name,
        name === "phone" ? /^More chat options/ : /^Threads/,
      );
      assert.equal(afterThreads.focusVisible, true);

      assert.equal(messageHeadings.drawn, 1, "message heading keeps its h3");
      assert.equal(messageHeadings.named, 0, "and stays out of the outline");
      assert.deepEqual(errors, []);
    });
  });
}
