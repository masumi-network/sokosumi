import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

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

async function expectStep(page: Page, path: RegExp, heading: string) {
  await page.waitForURL(path);
  await page
    .getByRole("main")
    .getByRole("heading", { name: heading })
    .waitFor();
}

for (const { name, isMobile, ...viewport } of PROJECTS) {
  describe(name, () => {
    test("Home's loading shell has Home's shape", async () => {
      const mailbox = await createMailbox();
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await page.goto(`${BASE_URL}/`);
      await page.getByRole("link", { name: "Register" }).click();
      await expectStep(page, /\/signup/, "Create your account");
      const chip = page.getByRole("button", {
        name: `${mailbox.address} Change email`,
      });
      for (let attempt = 0; !(await chip.isVisible()); attempt++) {
        assert.ok(attempt < 3, "the email step never took the address");
        await page
          .getByRole("textbox", { name: "Email" })
          .fill(mailbox.address);
        await page.getByRole("button", { name: "Continue with email" }).click();
        await chip.waitFor({ timeout: 10_000 }).catch(() => {});
      }
      await page.getByRole("textbox", { name: "First name" }).fill("Mira");
      await page.getByRole("textbox", { name: "Last name" }).fill(name);
      await page
        .getByRole("textbox", { name: "Code from the email" })
        .pressSequentially(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();
      await expectStep(page, /\/setup$/, "How do you want to work?");
      await page.getByRole("button", { name: "Continue" }).click();
      await expectStep(page, /\/setup\/assistant$/, "Name your Soko Bot");
      await page.getByRole("textbox", { name: "Name" }).fill(BOT);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: `Create ${BOT}` }).click();
      await page.waitForURL(/\/setup\/assistant\/connect$/);
      await page.getByRole("link", { name: "Skip" }).click();
      await page.waitForURL(/\/chat\/rooms\//);
      await page.getByRole("main").getByText(`I'm ${BOT}`).waitFor();

      // Home through the app's own navigation.
      if (name === "phone") {
        // A phone's chat room hides the tab bar; its Back shows it again.
        await page.getByRole("link", { name: "Back to chats" }).click();
        await page
          .getByRole("navigation", { name: "Main navigation" })
          .getByRole("link", { name: "Home" })
          .click();
      } else {
        const showSidebar = page.getByRole("button", { name: "Show sidebar" });
        if (await showSidebar.isVisible()) await showSidebar.click();
        await page.getByRole("link", { name: "Home", exact: true }).click();
      }
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
      const chips = await page
        .getByTestId("home-loading-chips")
        .locator('[data-slot="skeleton"]')
        .count();
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
      const loaded = await composer.boundingBox();
      await context.close();

      assert.ok(bones);
      assert.ok(loaded);
      assert.equal(chips, 3, "three suggestion chip bones");
      assert.equal(pickerFaces, 0, "the coworker picker's faces are gone");
      // The composer lands where its bone stood (24px slack for the
      // greeting's line height).
      assert.ok(
        Math.abs(bones.y - loaded.y) <= 24,
        `composer jumps ${Math.round(loaded.y - bones.y)}px after loading`,
      );
      assert.deepEqual(errors, []);
    });
  });
}
