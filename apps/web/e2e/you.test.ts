import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user finds every sidebar destination on the You page. On a phone the
// You page is the only menu, so Agents, TikTok Studio and Contacts must be
// there. Pages opened from it keep the You tab lit and go back to You by
// name, and the settings row is told apart from the Notifications inbox.
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
      // Rows carry `from=you` and keep their own params (the component test
      // covers TikTok Studio's project).
      for (const [name, pathname] of [
        ["Agents", "/agents"],
        ["TikTok Studio", "/tiktok-studio"],
        ["Contacts", "/contacts"],
      ]) {
        const href = new URL(
          (await menu
            .getByRole("link", { name, exact: true })
            .getAttribute("href")) ?? "",
          BASE_URL,
        );
        assert.equal(href.pathname, pathname, `${name} row`);
        assert.equal(href.searchParams.get("from"), "you", `${name} marker`);
      }
      assert.equal(
        await menu
          .getByRole("link", { name: "Notification settings", exact: true })
          .getAttribute("href"),
        "/account/notifications",
        "Notification settings row",
      );
      assert.equal(
        await menu
          .getByRole("link", { name: "Notifications", exact: true })
          .count(),
        0,
        "the row is named apart from the inbox",
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      assert.equal(overflow, false, "the page scrolls sideways");
      await shot("1-you");

      await menu.getByRole("link", { name: "Contacts", exact: true }).click();
      await page.waitForURL(`${BASE_URL}/contacts**`);
      await shot("2-contacts");

      if (size === "phone") {
        const tabs = page.getByRole("navigation", { name: "Main navigation" });
        const backToYou = page.getByRole("link", {
          name: "Back to You",
          exact: true,
        });
        for (const [row, path] of [
          ["Contacts", "/contacts"],
          ["Credit history", "/history"],
          ["Calendar", "/calendar"],
          ["Agents", "/agents"],
        ]) {
          if (row !== "Contacts") {
            await openYou();
            await menu.getByRole("link", { name: row, exact: true }).click();
            await page.waitForURL(`${BASE_URL}${path}**`);
          }
          assert.equal(
            await tabs
              .getByRole("link", { name: "You" })
              .getAttribute("aria-current"),
            "page",
            `${row} keeps the You tab lit`,
          );
          assert.equal(await backToYou.innerText(), "You", `${row} back`);
          await backToYou.click();
          await page.waitForURL(`${BASE_URL}/you`);
        }
        await shot("3-back-to-you");

        const youTab = tabs.getByRole("link", { name: "You" });
        const homeTab = tabs.getByRole("link", { name: "Home" });
        const brand = page.getByRole("link", { name: "Go to home" });
        const expectYouChrome = async (why: string) => {
          assert.equal(await youTab.getAttribute("aria-current"), "page", why);
          assert.equal(await backToYou.count(), 1, why);
        };
        const expectOwnChrome = async (why: string) => {
          assert.equal(await homeTab.getAttribute("aria-current"), "page", why);
          assert.equal(await backToYou.count(), 0, why);
          assert.equal(await brand.count(), 1, why);
        };

        // Each visit keeps its own chrome through Back, Forward and reload.
        await menu.getByRole("link", { name: "Contacts", exact: true }).click();
        await page.waitForURL(`${BASE_URL}/contacts?from=you`);
        await page.goBack();
        await page.waitForURL(`${BASE_URL}/you`);
        await page.goForward();
        await page.waitForURL(`${BASE_URL}/contacts?from=you`);
        await expectYouChrome("Forward to Contacts opened from You");
        await page.reload();
        await expectYouChrome("reload of Contacts opened from You");

        // A fresh visit that did not come from You keeps Home.
        await page.goto(`${BASE_URL}/contacts`);
        await expectOwnChrome("Contacts opened directly");

        // A Cmd/Ctrl-click opens a marked new tab and leaves this tab alone:
        // Back here still lands on the earlier, unmarked visit.
        await youTab.click();
        await page.waitForURL(`${BASE_URL}/you`);
        const [newTab] = await Promise.all([
          context.waitForEvent("page"),
          menu
            .getByRole("link", { name: "Contacts", exact: true })
            .click({ modifiers: ["ControlOrMeta"] }),
        ]);
        await newTab.waitForLoadState();
        assert.equal(new URL(newTab.url()).searchParams.get("from"), "you");
        await newTab.close();
        assert.equal(page.url(), `${BASE_URL}/you`);
        await page.goBack();
        await page.waitForURL(`${BASE_URL}/contacts`);
        await expectOwnChrome("Back to the visit opened directly");
        await openYou();

        await menu.getByRole("link", { name: "Ads", exact: true }).click();
        await page.waitForURL(`${BASE_URL}/ads**`);
        await backToYou.click();
        await page.waitForURL(`${BASE_URL}/you`);
        await shot("4-ads-back");
      }

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
