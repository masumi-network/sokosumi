import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user's Table summary, end to end: import a small invented CSV, open
// Summarize from Table options, group by Stage, read the counts and the Deal
// totals, then click Won to filter the Table to those rows. Each size signs up
// its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const CSV = [
  "Company,Stage,Deal",
  "Acme,Won,100",
  "Globex,Lead,20",
  "Initech,Won,50",
  "Umbrella,,5",
  "Hooli,Lost,30",
].join("\n");

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({ path: `${RESULTS_DIR}summary-${size}-${step}.png` });
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
    test("a new user counts a table by one column and filters to a value", async () => {
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
      await create.getByLabel("Title").fill("Pipeline");
      await create.locator('input[type="file"]').setInputFiles({
        name: "pipeline.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(CSV),
      });
      await create.getByText("Map columns and preview").waitFor();
      await create.getByRole("button", { name: "Create table" }).click();
      await page.waitForURL(/\/drive\/tables\//);
      await page.getByText("Initech", { exact: true }).waitFor();

      await page.getByRole("button", { name: "Table options" }).click();
      await page.getByRole("menuitem", { name: "Summarize" }).click();
      const dialog = page.getByRole("dialog", { name: "Summarize" });
      await dialog.getByLabel("Group by").selectOption({ label: "Stage" });
      await dialog.getByText("All 5 rows, 4 values.").waitFor();
      const won = dialog.getByRole("row").filter({
        has: page.getByRole("button", { name: "Won" }),
      });
      assert.deepEqual(
        (await won.getByRole("cell").allTextContents()).map((t) => t.trim()),
        ["Won", "2", "150"],
      );
      const total = dialog.getByRole("row").filter({ hasText: "Total" });
      assert.deepEqual(
        (await total.getByRole("cell").allTextContents()).map((t) => t.trim()),
        ["Total", "5", "205"],
      );
      await dialog.getByRole("button", { name: "No value" }).waitFor();
      await shot(page, size, "1-summary");

      await dialog.getByRole("button", { name: "Won" }).click();
      await dialog.waitFor({ state: "detached" });
      await page.getByText("Globex", { exact: true }).waitFor({
        state: "detached",
      });
      await page.getByText("Acme", { exact: true }).waitFor();
      await page.getByText("Initech", { exact: true }).waitFor();
      await shot(page, size, "2-filtered");

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
