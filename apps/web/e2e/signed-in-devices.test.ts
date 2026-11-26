import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user signed in twice (two isolated browser contexts) sees both
// devices under Account > Signed-in devices, signs the other one out from
// the first, and the list drops it. On desktop the signed-out context is then
// reloaded until it lands on sign-in: Core's cookie cache lets it pass for up
// to five minutes (ADR 0069), so that check waits up to seven.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({ path: `${RESULTS_DIR}devices-${size}-${step}.png` });
}

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  console.log(`E2E_BASE_URL=${BASE_URL}`);
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name: size, isMobile, ...viewport } of PROJECTS) {
  describe(size, () => {
    test("a new user signs out their other device", async () => {
      const options = { viewport, isMobile, hasTouch: isMobile };
      const first = await browser.newContext(options);
      const second = await browser.newContext(options);
      const page = await first.newPage();
      const other = await second.newPage();
      page.setDefaultTimeout(30_000);
      other.setDefaultTimeout(30_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      const mailbox = await createMailbox();
      await page.goto(`${BASE_URL}/signup`);
      await page.getByLabel("Email").fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByLabel("First name").fill("E2E");
      await page.getByLabel("Last name").fill("Tester");
      await page
        .getByLabel("Code from the email")
        .fill(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("link", { name: "Later" }).click();
      await page.waitForURL(`${BASE_URL}/`);

      await other.goto(`${BASE_URL}/signin`);
      await other.getByLabel("Email").fill(mailbox.address);
      await other.getByRole("button", { name: "Continue with email" }).click();
      const code = other.getByLabel("Code from the email");
      await code.fill(await mailbox.nextCode());
      await code.press("Enter");
      await other.waitForURL(`${BASE_URL}/`);

      await page.goto(`${BASE_URL}/account`);
      const card = page.locator('[data-slot="card"]').filter({
        has: page.getByRole("heading", { name: "Signed-in devices" }),
      });
      const rows = card.getByRole("listitem");
      await rows.nth(1).waitFor();
      assert.equal(await rows.count(), 2, "both devices listed");
      await rows.first().getByText("This device").waitFor();
      await card.scrollIntoViewIfNeeded();
      await shot(page, size, "1-two-devices");

      // Only the other device's row: "Sign out all other devices" also
      // starts with "Sign out".
      await rows
        .nth(1)
        .getByRole("button", { name: /^Sign out / })
        .click();
      await page.getByText("Device signed out.").waitFor();
      await rows.nth(1).waitFor({ state: "detached" });
      assert.equal(
        await card
          .getByRole("button", { name: "Sign out all other devices" })
          .count(),
        0,
        "bulk sign-out still offered with one device",
      );
      await shot(page, size, "2-signed-out");

      if (size === "desktop") {
        const deadline = Date.now() + 7 * 60_000;
        let signedOut = false;
        while (!signedOut && Date.now() < deadline) {
          await other.goto(`${BASE_URL}/account`);
          signedOut = new URL(other.url()).pathname === "/signin";
          if (!signedOut) await other.waitForTimeout(20_000);
        }
        assert.ok(signedOut, "signed-out device still opens Account");
      }

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      await first.close();
      await second.close();
      assert.equal(overflow, 0, `page overflows by ${overflow}px`);
      assert.deepEqual(errors, []);
    });
  });
}
