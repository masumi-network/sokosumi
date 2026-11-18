import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import {
  type Browser,
  type BrowserContext,
  type BrowserType,
  chromium,
  devices,
  type Page,
  webkit,
} from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

/**
 * Phone back navigation in a chat room, as the installed app uses it:
 * - the top bar's Back pops to the chat list instead of pushing a new one,
 *   so a swipe back afterwards never reopens the room just left;
 * - a swipe back (history back) shows the list with its tab bar;
 * - the tab bar never shows over an open room, not for a single frame.
 */
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const ROOM_URL = /\/chat\/rooms\/[^/?]+/;
const CHANNEL = "Launch Plans";

const PHONES: Array<{
  name: string;
  browserType: BrowserType;
  device: (typeof devices)[string];
}> = [
  { name: "iphone-webkit", browserType: webkit, device: devices["iPhone 15"] },
  {
    name: "android-chromium",
    browserType: chromium,
    device: devices["Pixel 7"],
  },
];

/**
 * Counts animation frames that paint the tab bar and a room's message list
 * together, in every document the context opens.
 */
const OVERLAP_PROBE = `
  window.__overlapFrames = 0;
  const shows = (element) =>
    element != null && element.getClientRects().length > 0;
  const tick = () => {
    if (
      shows(document.querySelector("[data-mobile-bottom-nav]")) &&
      shows(document.querySelector('[data-chat-message-list="room"]'))
    )
      window.__overlapFrames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
`;

const overlapFrames = (page: Page) =>
  page.evaluate(() => (window as { __overlapFrames?: number }).__overlapFrames);
const resetOverlap = (page: Page) =>
  page.evaluate(() => {
    (window as { __overlapFrames?: number }).__overlapFrames = 0;
  });
const historyLength = (page: Page) => page.evaluate(() => history.length);

const tabBar = (page: Page) => page.locator("[data-mobile-bottom-nav]");
const composer = (page: Page) =>
  page.getByRole("textbox", { name: `Message #${CHANNEL}` });
const backToChats = (page: Page) =>
  page.getByRole("link", { name: "Back to chats" });
const roomLink = (page: Page) =>
  page.getByRole("link", { name: CHANNEL }).first();

/** Lets a transition settle before reading what it left on screen. */
const settle = (page: Page) => page.waitForTimeout(600);

async function openChatsTab(page: Page) {
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Chats" })
    .click();
  await page.waitForURL(`${BASE_URL}/chat`);
  await roomLink(page).waitFor();
}

/** A new user's first channel, started from the first Catch up. */
async function createChannel(page: Page) {
  await page.getByText("No direct messages yet.").waitFor();
  await page.getByRole("link", { name: "Catch up" }).first().click();
  await page.getByRole("button", { name: "Create a channel" }).click();
  await page
    .getByRole("textbox", { name: "Handle" })
    .pressSequentially("launch-plans", { delay: 30 });
  await page.getByRole("radio", { name: "External" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(ROOM_URL);
  await composer(page).waitFor();
}

for (const { name, browserType, device } of PHONES) {
  describe(name, () => {
    let browser: Browser;
    let context: BrowserContext;
    let page: Page;
    const errors: string[] = [];
    const shot = (target: Page, step: string) =>
      target.screenshot({ path: `${RESULTS_DIR}${name}-${step}.png` });

    before(async () => {
      mkdirSync(RESULTS_DIR, { recursive: true });
      browser = await browserType.launch();
      context = await browser.newContext(device);
      await context.addInitScript(OVERLAP_PROBE);
      page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await signUpWithOrganization(page, BASE_URL);
      await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Chats" })
        .click();
      await createChannel(page);
      await backToChats(page).click();
      await page.waitForURL(`${BASE_URL}/chat`);
      await roomLink(page).waitFor();
    });
    after(() => browser.close());

    test("Back pops to the list, and a swipe back after it never reopens the room", async () => {
      const lengthOnList = await historyLength(page);
      await resetOverlap(page);

      await roomLink(page).click();
      await page.waitForURL(ROOM_URL);
      await composer(page).waitFor();
      await settle(page);
      await shot(page, "1-room");
      const tabBarInRoom = await tabBar(page).isVisible();

      await backToChats(page).click();
      await page.waitForURL(`${BASE_URL}/chat`);
      await roomLink(page).waitFor();
      await settle(page);
      await shot(page, "2-back-to-list");
      const lengthAfterBack = await historyLength(page);
      const tabBarOnList = await tabBar(page).isVisible();

      // The swipe-back gesture is a history back.
      await page.goBack();
      await settle(page);
      await shot(page, "3-swipe-back-after-back");
      const urlAfterSwipe = page.url();
      const overlap = await overlapFrames(page);

      await openChatsTab(page);

      assert.equal(tabBarInRoom, false, "tab bar shows in the room");
      assert.equal(tabBarOnList, true, "tab bar missing on the list");
      // One entry for the room; Back must not add another for the list.
      assert.equal(lengthAfterBack, lengthOnList + 1, "Back pushed history");
      assert.doesNotMatch(urlAfterSwipe, ROOM_URL, "swipe back reopened room");
      assert.equal(overlap, 0, "tab bar painted over the room");
    });

    test("a swipe back from a room shows the list with its tab bar", async () => {
      await resetOverlap(page);

      await roomLink(page).click();
      await page.waitForURL(ROOM_URL);
      await composer(page).waitFor();
      await settle(page);

      await page.goBack();
      await page.waitForURL(`${BASE_URL}/chat`);
      await roomLink(page).waitFor();
      await settle(page);
      await shot(page, "4-swipe-back-from-room");
      const tabBarOnList = await tabBar(page).isVisible();
      const composerOnList = await composer(page).isVisible();

      // Swipe forward again: the room, without the tab bar.
      await page.goForward();
      await page.waitForURL(ROOM_URL);
      await composer(page).waitFor();
      await settle(page);
      await shot(page, "5-swipe-forward-to-room");
      const tabBarInRoom = await tabBar(page).isVisible();
      const overlap = await overlapFrames(page);

      await page.goBack();
      await page.waitForURL(`${BASE_URL}/chat`);

      assert.equal(tabBarOnList, true, "tab bar missing after swipe back");
      assert.equal(composerOnList, false, "room still shows after swipe back");
      assert.equal(tabBarInRoom, false, "tab bar shows in the room");
      assert.equal(overlap, 0, "tab bar painted over the room");
    });

    test("Back from a room opened by a link swaps it for the list", async () => {
      await roomLink(page).click();
      await page.waitForURL(ROOM_URL);
      const roomUrl = page.url();

      // A notification or shared link opens the room as the tab's first page.
      const linked = await context.newPage();
      linked.on("pageerror", (e) => errors.push(e.message));
      await linked.goto(roomUrl);
      await composer(linked).waitFor();
      const lengthInRoom = await historyLength(linked);

      await backToChats(linked).click();
      await linked.waitForURL(`${BASE_URL}/chat`);
      await roomLink(linked).waitFor();
      await settle(linked);
      await shot(linked, "6-back-from-linked-room");
      const lengthOnList = await historyLength(linked);

      await linked.goBack().catch(() => null);
      await settle(linked);
      const urlAfterSwipe = linked.url();
      await linked.close();

      assert.equal(lengthOnList, lengthInRoom, "Back pushed history");
      assert.doesNotMatch(urlAfterSwipe, ROOM_URL, "swipe back reopened room");
      // WebKit reports a fetch it cancels (an RSC or rooms read cut short by
      // a navigation) as a page error "due to access control checks";
      // Chromium runs the same steps without one.
      assert.deepEqual(
        errors.filter(
          (message) => !message.endsWith("due to access control checks."),
        ),
        [],
      );
    });
  });
}
