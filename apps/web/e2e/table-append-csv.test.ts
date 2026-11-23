import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user adds a second, overlapping CSV export to a Files Table: headers
// match by name, an unknown header is left out, and the row already in the
// Table is skipped. Each size signs up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const WEEK_1 = ["Company,Contact", "Acme,Lena Ortiz", "Globex,Sam Reid"].join(
  "\n",
);
const WEEK_2 = [
  "contact,Company,Source",
  "Sam Reid,Globex,Expo",
  "Priya Shah,Initech,Web",
  "Tom Berg,Umbrella,Expo",
].join("\n");

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}append-csv-${size}-${step}.png`,
  });
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
    test("a new user adds the new rows of a CSV to a table", async () => {
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

      await page.goto(`${BASE_URL}/drive?view=tables`);
      await page.getByRole("button", { name: "New table" }).click();
      const create = page.getByRole("dialog", { name: "New table" });
      await create.getByLabel("Title").fill("Expo leads");
      await create.locator('input[type="file"]').setInputFiles({
        name: "week-1.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(WEEK_1),
      });
      await create.getByText("Map columns and preview").waitFor();
      await create.getByRole("button", { name: "Create table" }).click();
      await page.waitForURL(/\/drive\/tables\//);
      await page.getByText("Globex", { exact: true }).waitFor();

      const menu = page.getByRole("button", { name: "Table options" });
      await menu.click();
      await page.getByRole("menuitem", { name: "Add rows from CSV" }).click();
      const dialog = page.getByRole("dialog", { name: "Add rows from CSV" });
      await dialog.locator('input[type="file"]').setInputFiles({
        name: "week-2.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(WEEK_2),
      });
      await dialog.getByText("Fills: Contact, Company").waitFor();
      await dialog
        .getByText("Left out, no text column with this name: Source")
        .waitFor();
      const skip = dialog.getByRole("checkbox", {
        name: "Leave out 1 row that is already in this table",
      });
      assert.equal(await skip.getAttribute("aria-checked"), "true");
      await shot(page, size, "1-plan");
      await dialog.getByRole("button", { name: "Add 2 rows" }).click();
      await page.getByText("Added 2 rows.").waitFor();
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute("aria-label") ===
          "Table options",
      );
      await page.getByText("Initech", { exact: true }).waitFor();
      await page.getByText("Umbrella", { exact: true }).waitFor();
      assert.equal(
        await page.getByText("Globex", { exact: true }).count(),
        1,
        "the row already in the table is not added again",
      );
      await shot(page, size, "2-added");

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
