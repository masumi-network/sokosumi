import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user's Find and replace in a Files Table, end to end: import a small
// invented CSV, replace one company name written three ways, see only the
// whole-cell matches change, then undo the batch from History. Each size
// signs up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const CSV = [
  "Company,Contact",
  "Acme Inc,Lena Ortiz",
  "ACME INC,Sam Reid",
  "acme inc,Priya Shah",
  "Acme Inc Ltd,Tom Berg",
  "Globex,Mia Chen",
].join("\n");

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}find-replace-${size}-${step}.png`,
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
    test("a new user replaces a value across a table and undoes it", async () => {
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
        name: "expo-leads.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(CSV),
      });
      await create.getByText("Map columns and preview").waitFor();
      await create.getByRole("button", { name: "Create table" }).click();
      await page.waitForURL(/\/drive\/tables\//);
      await page.getByText("ACME INC", { exact: true }).waitFor();

      const menu = page.getByRole("button", { name: "Table options" });
      await menu.click();
      await page.getByRole("menuitem", { name: "Find and replace" }).click();
      const dialog = page.getByRole("dialog", { name: "Find and replace" });
      await dialog.getByLabel("Find").fill("acme inc");
      await dialog.getByLabel("Replace with").fill("Acme");
      await dialog.getByRole("button", { name: "Find matches" }).click();
      await dialog.getByText("3 cells will change.").waitFor();
      await shot(page, size, "1-matches");
      await dialog.getByRole("button", { name: "Replace 3 cells" }).click();
      await page.getByText("Replaced 3 cells.").waitFor();
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute("aria-label") ===
          "Table options",
      );
      const acme = page.getByText("Acme", { exact: true });
      await page.waitForFunction(
        () =>
          ![...document.querySelectorAll("td, [role=gridcell]")].some(
            (cell) => cell.textContent?.trim().toLowerCase() === "acme inc",
          ),
      );
      assert.equal(await acme.count(), 3, "three cells now read Acme");
      await page.getByText("Acme Inc Ltd", { exact: true }).waitFor();
      await shot(page, size, "2-replaced");

      // The success toast's action opens History.
      await page
        .getByRole("region", { name: /^Notifications/ })
        .getByRole("button", { name: "History and sources" })
        .click();
      const history = page.getByRole("dialog", { name: "History and sources" });
      await history.getByRole("button", { name: "Undo batch" }).first().click();
      await page.keyboard.press("Escape");
      await page.getByText("ACME INC", { exact: true }).waitFor();
      await shot(page, size, "3-undone");

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
