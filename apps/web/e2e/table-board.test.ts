import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";

/**
 * A Files Table as a board, end to end: import a small invented pipeline,
 * add a Stage option column, switch to Board, move a card with its Move to
 * menu and see the cell changed back in Table. Needs a Playwright storage
 * state for a test account in E2E_STORAGE_STATE (create it per run, never
 * commit it); without one the spec is skipped.
 */
const STORAGE_STATE = process.env.E2E_STORAGE_STATE?.trim();
const BASE_URL = STORAGE_STATE ? resolveBaseUrl(process.env) : "";
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const CSV = [
  "Company,Contact,Stage",
  "Northwind Bakery,Lena Ortiz,Lead",
  "Orbit Cycles,Priya Shah,",
].join("\n");

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

let browser: Browser;
before(async () => {
  if (!STORAGE_STATE) return;
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
});
after(() => browser?.close());

for (const { name: size, isMobile, ...viewport } of PROJECTS) {
  describe(`table board ${size}`, { skip: !STORAGE_STATE }, () => {
    test("moves a row between options on the board", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
        storageState: STORAGE_STATE,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await page.goto(`${BASE_URL}/drive?view=tables`);
      await page.getByRole("button", { name: "New table" }).click();
      const create = page.getByRole("dialog", { name: "New table" });
      await create.getByLabel("Title").fill(`E2E board ${size}`);
      await create.locator('input[type="file"]').setInputFiles({
        name: "pipeline.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(CSV),
      });
      await create.getByText("Map columns and preview").waitFor();
      // Stage becomes the option column the board's lanes come from.
      await create
        .getByRole("combobox", { name: "Type" })
        .nth(2)
        .selectOption({ label: "Single select" });
      await create
        .getByRole("textbox", { name: /^Options for Stage/ })
        .fill("Lead;Won");
      await create.getByRole("button", { name: "Create table" }).click();
      await page.waitForURL(/\/drive\/tables\//);
      await page
        .getByRole("grid")
        .getByText("Orbit Cycles", { exact: true })
        .waitFor();

      await page.getByRole("radio", { name: "Board" }).click();
      const noStage = page.getByRole("region", { name: "No Stage" });
      await noStage.getByText("Orbit Cycles").waitFor();
      await page.getByRole("button", { name: "Move Orbit Cycles" }).click();
      await page.getByRole("menuitemradio", { name: "Won" }).click();
      await page
        .getByRole("region", { name: "Won" })
        .getByText("Orbit Cycles")
        .waitFor();
      await page.screenshot({ path: `${RESULTS_DIR}table-board-${size}.png` });

      await page.getByRole("radio", { name: "Table" }).click();
      await page.getByRole("gridcell", { name: /^Won/ }).waitFor();

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
