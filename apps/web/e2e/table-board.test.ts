import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

// A Files Table as a board, end to end, for a new user per size (disposable
// mail.tm inbox): import a small invented pipeline with Stage as an option
// column, switch to Board, move the unset card to Won from its Move menu, and
// see the cell read Won back in Table.
const BASE_URL = resolveBaseUrl(process.env);
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
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name: size, isMobile, ...viewport } of PROJECTS) {
  describe(`table board ${size}`, () => {
    test("moves a row between options on the board", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await signUpWithOrganization(page, BASE_URL);
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
      // Lanes scroll inside the board, never the page.
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      assert.equal(overflow, 0, `board overflows the page by ${overflow}px`);

      await page.getByRole("radio", { name: "Table" }).click();
      await page.getByRole("gridcell", { name: /^Won/ }).waitFor();

      await context.close();
      assert.deepEqual(errors, []);
    });
  });
}
