import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user finds an agent from the Agents gallery and reads its profile.
// The profile keeps the app's side gutter at every size, and its Find field
// shows below the header (on a phone it once sat under the top bar).
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const GUTTER = 12;

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
    test("a new user opens an agent's profile from the gallery", async () => {
      const mailbox = await createMailbox();
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({ path: `${RESULTS_DIR}agents-${size}-${step}.png` });

      await page.goto(`${BASE_URL}/signup`);
      await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByRole("textbox", { name: "First name" }).fill("E2E");
      await page.getByRole("textbox", { name: "Last name" }).fill("Agents");
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
        await page
          .getByRole("navigation", { name: "You" })
          .getByRole("link", { name: "Agents", exact: true })
          .click();
      } else {
        await page.getByRole("link", { name: "Agents", exact: true }).click();
      }
      await page.waitForURL(`${BASE_URL}/agents**`);

      await page
        .getByRole("textbox", { name: "Search agents", exact: true })
        .fill("research");
      const card = page.locator('main a[href^="/agents/"]').first();
      await card.scrollIntoViewIfNeeded();
      await shot("1-gallery");
      await card.click();
      await page.waitForURL(/\/agents\/[^/?]+$/);

      const title = page.getByRole("heading", { level: 1 });
      await title.waitFor();
      const box = await title.boundingBox();
      assert.ok(box, "the agent name shows");
      assert.ok(box.x >= GUTTER, `name starts ${box.x}px from the edge`);

      const find = page.getByRole("searchbox", { name: "Find on this page" });
      await find.waitFor();
      const findVisible = await find.evaluate((input) => {
        const r = input.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        return Boolean(hit && input.closest("div")?.contains(hit));
      });
      assert.ok(findVisible, "the Find field is not covered by the header");

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      assert.equal(overflow, false, "the page scrolls sideways");
      await shot("2-profile");

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
