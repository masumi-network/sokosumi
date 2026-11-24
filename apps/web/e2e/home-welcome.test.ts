import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { openHome, signUpWithSokoBot } from "./sign-up-with-soko-bot.ts";

// A new user creates a Soko Bot, leaves setup at the Connect step and opens
// the app again: the bot's unread welcome is the first Needs you row, it
// opens the bot's chat, and once read it is gone and "Nothing waits on you."
// is back. (Skip opens the chat, which reads the welcome on the way.)
// Each size signs up a new throwaway user; nothing is paid for or connected.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];
const BOT = "Pip";

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name, isMobile, ...viewport } of PROJECTS) {
  describe(name, () => {
    test("Home lists the bot's unread welcome until it is read", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await signUpWithSokoBot(page, BASE_URL, {
        bot: BOT,
        lastName: `welcome ${name}`,
        leaveAtConnect: true,
      });
      // Next keeps visited pages hidden in the DOM; read the one on screen.
      const needsYou = page
        .getByTestId("home-needs-you")
        .filter({ visible: true });
      const row = needsYou.getByTestId("home-needs-you-row").first();
      await row.waitFor();
      const link = row.getByRole("link");
      assert.match(
        (await link.textContent()) ?? "",
        new RegExp(`${BOT} sent you a welcome`),
      );
      await page.screenshot({ path: `${RESULTS_DIR}home-welcome-${name}.png` });

      await link.click();
      await page.waitForURL(/\/chat\/rooms\/[^/?]+\?message=/);
      await page.getByRole("main").getByText(`I'm ${BOT}`).waitFor();
      // The chat reads a room once the reader reaches its end, after the
      // jump; leaving sooner keeps it unread. The tab drops "(1)" then.
      await page.waitForFunction(() => !document.title.startsWith("("));

      await openHome(page, name === "phone");
      await needsYou.getByText("Nothing waits on you.").waitFor();
      assert.equal(
        await needsYou.getByText(`${BOT} sent you a welcome`).count(),
        0,
      );
      await page.screenshot({
        path: `${RESULTS_DIR}home-welcome-read-${name}.png`,
      });
      await context.close();
      assert.deepEqual(errors, []);
    });
  });
}
