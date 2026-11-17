import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user's archived contact, end to end: add a contact, archive it from
// its panel, open Archived contacts from the More actions menu (there is no
// Archived tab), see the panel is read-only (its edit menus stay shut),
// restore it from its row, and go back to All contacts. Each size signs up
// its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const NAME = "Mira Testperson";

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({ path: `${RESULTS_DIR}contacts-${size}-${step}.png` });
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
    test("a new user archives a contact and restores it", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
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

      await page.goto(`${BASE_URL}/contacts`);
      // The empty state renders once the client has loaded the contacts, so
      // the toolbar is live by then.
      await page.getByRole("button", { name: "Add someone" }).waitFor();
      await page
        .getByRole("button", { name: "Add contact" })
        .filter({ visible: true })
        .click();
      const add = page.getByRole("dialog", { name: "Add contact" });
      await add.getByLabel("Name").fill(NAME);
      await add.getByRole("button", { name: "Add contact" }).click();

      const panel = page.getByRole("dialog", { name: NAME });
      await panel.getByRole("button", { name: "Contact options" }).click();
      await page.getByRole("menuitem", { name: "Archive contact" }).click();
      await page.getByText(`${NAME} archived`).waitFor();

      assert.equal(
        await page.getByRole("radio", { name: /Archived/ }).count(),
        0,
        "Archived is a tab",
      );
      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Archived contacts" }).click();
      await page.getByRole("heading", { name: "Archived contacts" }).waitFor();
      const row = page.getByRole("button", { name: NAME, exact: true });
      await row.waitFor();
      await shot(page, size, "1-archived");

      // The panel is read-only: its edit menus do not open.
      await row.click();
      const archivedPanel = page.getByRole("dialog", { name: NAME });
      await archivedPanel.getByText(/^Archived on /).waitFor();
      const stage = archivedPanel.getByRole("button", {
        name: /Change stage$/,
      });
      assert.equal(await stage.isDisabled(), true, "stage menu is enabled");
      await shot(page, size, "2-panel");
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: `Restore ${NAME}` }).click();
      await page.getByText(`${NAME} restored`).waitFor();
      await page.getByRole("button", { name: "Back to contacts" }).click();
      await page
        .getByRole("radio", { name: "All contacts", checked: true })
        .waitFor();
      await page.getByRole("button", { name: NAME }).first().waitFor();
      await shot(page, size, "3-back");

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      await context.close();
      assert.equal(overflow, 0, `page overflows by ${overflow}px`);
      assert.deepEqual(errors, []);
    });
  });
}
