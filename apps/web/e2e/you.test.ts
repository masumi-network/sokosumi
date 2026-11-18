import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user finds every sidebar destination on the You page. On a phone the
// You page is the only menu, so Agents, TikTok Studio and Contacts must be
// there, and Ads opened from it goes back to You, not to Chats.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  console.log(`E2E_BASE_URL=${BASE_URL}`);
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name: size, ...viewport } of PROJECTS) {
  describe(size, () => {
    test("a new user reaches every destination from You", async () => {
      const mailbox = await createMailbox();
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({ path: `${RESULTS_DIR}you-${size}-${step}.png` });

      await page.goto(`${BASE_URL}/signup`);
      await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByRole("textbox", { name: "First name" }).fill("E2E");
      await page.getByRole("textbox", { name: "Last name" }).fill("You");
      await page
        .getByRole("textbox", { name: "Code from the email" })
        .pressSequentially(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("link", { name: "Later" }).click();
      await page.waitForURL(`${BASE_URL}/`);

      const openYou = async () => {
        if (size === "phone") {
          await page
            .getByRole("navigation", { name: "Main navigation" })
            .getByRole("link", { name: "You" })
            .click();
        } else {
          // Wider screens have the sidebar; the You page is the phone menu.
          await page.goto(`${BASE_URL}/you`);
        }
        await page.waitForURL(`${BASE_URL}/you`);
      };
      await openYou();

      const menu = page.getByRole("navigation", { name: "You" });
      for (const [name, href] of [
        ["Agents", "/agents"],
        ["TikTok Studio", "/tiktok-studio"],
        ["Contacts", "/contacts"],
      ]) {
        assert.equal(
          await menu
            .getByRole("link", { name, exact: true })
            .getAttribute("href"),
          href,
          `${name} row`,
        );
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      assert.equal(overflow, false, "the page scrolls sideways");
      await shot("1-you");

      await menu.getByRole("link", { name: "Contacts", exact: true }).click();
      await page.waitForURL(`${BASE_URL}/contacts**`);
      await shot("2-contacts");

      if (size === "phone") {
        await openYou();
        await menu.getByRole("link", { name: "Ads", exact: true }).click();
        await page.waitForURL(`${BASE_URL}/ads**`);
        await page.getByRole("link", { name: "Back", exact: true }).click();
        await page.waitForURL(`${BASE_URL}/you`);
        await shot("3-ads-back");
      }

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
