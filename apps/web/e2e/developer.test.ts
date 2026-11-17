import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user creates an API key and sees it in the list at every size. On a
// phone they reach Developer from the You tab, and the header Back returns to
// the Developer menu, not to Chats.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const KEY_NAME = "E2E recipe sync";

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
    test("a new user creates an API key and sees it in the list", async () => {
      const mailbox = await createMailbox();
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}developer-${size}-${step}.png`,
        });

      await page.goto(`${BASE_URL}/signup`);
      await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByRole("textbox", { name: "First name" }).fill("E2E");
      await page.getByRole("textbox", { name: "Last name" }).fill("Developer");
      await page
        .getByRole("textbox", { name: "Code from the email" })
        .pressSequentially(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("link", { name: "Later" }).click();
      await page.waitForURL(`${BASE_URL}/`);

      if (size === "phone") {
        await page
          .getByRole("navigation", { name: "Main navigation" })
          .getByRole("link", { name: "You" })
          .click();
        await page.getByRole("link", { name: "Developer" }).click();
        await page
          .getByRole("navigation", { name: "Developer" })
          .getByRole("link", { name: "API keys" })
          .click();
      } else {
        await page.goto(`${BASE_URL}/developer/api-keys`);
      }

      await page.getByRole("button", { name: "Create" }).click();
      const dialog = page.getByRole("dialog", { name: "Create new API key" });
      await dialog.getByRole("textbox", { name: "Name" }).fill(KEY_NAME);
      await dialog.getByRole("button", { name: "Create API key" }).click();
      await page
        .getByRole("dialog", { name: "New API key created" })
        .getByRole("button", { name: "Done" })
        .click();

      // The new key's row sits inside the screen, not beside the header.
      const row = page.getByText(KEY_NAME, { exact: true });
      await row.waitFor();
      const box = await row.boundingBox();
      assert.ok(
        box && box.x >= 0 && box.x + box.width <= viewport.width,
        `the key row is off screen at x=${box?.x}`,
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      assert.equal(overflow, false, "the page scrolls sideways");
      await shot("1-api-keys");

      if (size === "phone") {
        await page.getByRole("link", { name: "Back", exact: true }).click();
        await page.waitForURL(`${BASE_URL}/you/developer`);
        await page
          .getByRole("heading", { level: 1, name: "Developer" })
          .waitFor();
        await shot("2-back");
      }

      assert.deepEqual(errors, [], "page errors");
      await context.close();
    });
  });
}
