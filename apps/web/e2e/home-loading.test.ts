import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { openHome, signUpWithSokoBot } from "./sign-up-with-soko-bot.ts";

// A new user sets up a Soko Bot, opens Home, and reloads it on a slow
// connection: the loading shell draws Home's own shape (bot face, composer,
// chips, list), not the retired coworker picker, and the composer does not
// jump when the page replaces it.
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
    test("Home's loading shell has Home's shape", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await signUpWithSokoBot(page, BASE_URL, { bot: BOT, lastName: name });
      await openHome(page, name === "phone");
      const composer = page.getByRole("textbox", { name: `Ask ${BOT}…` });
      await composer.waitFor();

      // Reload on a slow line and catch the loading shell.
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 2000,
        downloadThroughput: 50_000,
        uploadThroughput: 50_000,
      });
      await page.reload({ waitUntil: "commit" });
      const shell = page.getByTestId("home-loading");
      await shell.waitFor();
      const bones = await page
        .getByTestId("home-loading-composer")
        .boundingBox();
      const chipBones = page.getByTestId("home-loading-chips");
      const chipsBone = await chipBones.boundingBox();
      const chips = await chipBones.locator('[data-slot="skeleton"]').count();
      // The retired picker's featured face and four teammates.
      const pickerFaces = await shell.locator(".size-20, .size-11").count();
      await page.screenshot({ path: `${RESULTS_DIR}home-loading-${name}.png` });
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      // Measured in the same reload as its bone, once the page settles.
      await composer.waitFor();
      await page
        .getByRole("heading", { name: "In the last 24 hours" })
        .waitFor();
      // The kept-alive chat room has a composer card too.
      const loaded = await page
        .locator("[data-room-composer-mention-anchor]")
        .filter({ has: composer })
        .boundingBox();
      const firstChip = await page
        .getByRole("button", { name: "Catch me up" })
        .boundingBox();
      await context.close();

      assert.ok(bones && chipsBone);
      assert.ok(loaded && firstChip);
      assert.equal(chips, 3, "three suggestion chip bones");
      assert.equal(pickerFaces, 0, "the coworker picker's faces are gone");
      // The composer card and the chips land where their bones stood.
      const moves = {
        "composer top": loaded.y - bones.y,
        "composer left": loaded.x - bones.x,
        "composer width": loaded.width - bones.width,
        "composer height": loaded.height - bones.height,
        "chips top": firstChip.y - chipsBone.y,
      };
      for (const [what, px] of Object.entries(moves)) {
        assert.ok(Math.abs(px) <= 4, `${what} moves ${Math.round(px)}px`);
      }
      console.log(name, JSON.stringify(moves));
      assert.deepEqual(errors, []);
    });
  });
}
