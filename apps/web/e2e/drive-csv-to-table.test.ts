import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user turns a CSV already in Files into a Table: upload an invented
// CSV, open it, Open as table, check the mapping and preview (a leading-zero
// code stays text), create, and find the rows in the Table. Each size signs
// up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const CSV = [
  "Shop,Zip,Orders",
  "Corner Bakery,01067,12",
  "Harbour Deli,04109,7",
].join("\n");

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}csv-to-table-${size}-${step}.png`,
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
    test("a new user opens a CSV from Files as a table", async () => {
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

      await page.goto(`${BASE_URL}/drive?view=workspace`);
      await page
        .getByRole("tab", { name: "Workspace", selected: true })
        .waitFor();
      await page
        .locator('input[type="file"]:not([webkitdirectory])')
        .first()
        .setInputFiles({
          name: "shops.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(CSV),
        });
      await page.getByRole("link", { name: "shops.csv" }).click();
      const viewer = page.getByTestId("drive-file-viewer");
      await viewer.getByRole("columnheader", { name: "Zip" }).waitFor();
      await shot(page, size, "1-viewer");

      await viewer.getByRole("button", { name: "Open as table" }).click();
      const create = page.getByRole("dialog", { name: "New table" });
      await create.getByRole("cell", { name: "01067" }).waitFor();
      assert.equal(await create.getByLabel("Title").inputValue(), "shops");
      assert.deepEqual(
        await create
          .getByRole("textbox", { name: "Column name" })
          .evaluateAll((inputs) =>
            inputs.map((input) => (input as HTMLInputElement).value),
          ),
        ["Shop", "Zip", "Orders"],
      );
      await shot(page, size, "2-mapping");

      await create.getByRole("button", { name: "Create table" }).click();
      await page.waitForURL(/\/drive\/tables\//);
      await page.getByText("Harbour Deli").waitFor();
      await page.getByText("04109").waitFor();
      await shot(page, size, "3-table");

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
