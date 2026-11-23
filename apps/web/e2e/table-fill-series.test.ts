import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user fills a Files Table's date column with a weekly series, end to
// end: import a small invented content plan, preview the first rows, fill,
// see every row dated in the order shown, and find focus back on the column
// button. Each size signs up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const CSV = [
  "Post,Publish on",
  "Teaser video,",
  "Behind the scenes,",
  "Customer story,",
  "Feature tips,",
  "Launch day,",
  "Thank-you note,",
].join("\n");
const DATES = [
  "Dec 1, 2026",
  "Dec 8, 2026",
  "Dec 15, 2026",
  "Dec 22, 2026",
  "Dec 29, 2026",
  "Jan 5, 2027",
];

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}fill-series-${size}-${step}.png`,
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
    test("a new user fills a date column with a weekly series", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
        locale: "en-US",
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
      await create.getByLabel("Title").fill("Launch content plan");
      await create.locator('input[type="file"]').setInputFiles({
        name: "content-plan.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(CSV),
      });
      await create.getByText("Map columns and preview").waitFor();
      await create
        .getByRole("combobox", { name: "Type" })
        .nth(1)
        .selectOption("Date");
      await create.getByRole("button", { name: "Create table" }).click();
      await page.waitForURL(/\/drive\/tables\//);
      await page.getByText("Thank-you note", { exact: true }).waitFor();

      const columnMenu = page.getByRole("button", {
        name: "Column options: Publish on",
      });
      await columnMenu.click();
      await page.getByRole("menuitem", { name: "Fill series…" }).click();
      const dialog = page.getByRole("dialog", {
        name: "Fill Publish on with a series",
      });
      await dialog.getByLabel("Start with").fill("2026-12-01");
      await dialog.getByLabel("Every").selectOption("week");
      await dialog.getByRole("button", { name: "Preview" }).click();
      await dialog
        .getByText("6 cells will change.", { exact: false })
        .waitFor();
      const preview = await dialog.getByRole("listitem").allInnerTexts();
      assert.deepEqual(
        preview.map((item) => item.replace(/\s+/g, " ").trim()),
        [
          "Row 1 Teaser video Dec 1, 2026",
          "Row 2 Behind the scenes Dec 8, 2026",
          "Row 3 Customer story Dec 15, 2026",
        ],
      );
      await shot(page, size, "1-preview");
      await dialog.getByRole("button", { name: "Fill 6 cells" }).click();
      await page.getByText("Filled 6 cells.", { exact: false }).waitFor();
      for (const date of DATES) await page.getByText(date).first().waitFor();
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute("aria-label") ===
          "Column options: Publish on",
      );
      await shot(page, size, "2-filled");

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
