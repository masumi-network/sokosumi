import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import JSZip from "jszip";
import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user turns one sheet of an Excel workbook in Files into a Table:
// upload an invented two-sheet workbook, open it, Open as table, pick the
// second sheet, check its mapping, create, and find its rows in the Table.
// Each size signs up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const SHEETS: Record<string, (string | number)[][]> = {
  Shops: [
    ["Shop", "Zip", "Orders"],
    ["Corner Bakery", "01067", 12],
    ["Harbour Deli", "04109", 7],
  ],
  Deliveries: [
    ["Shop", "Boxes", "Driver"],
    ["Corner Bakery", 4, "Mina"],
    ["Harbour Deli", 2, "Oskar"],
  ],
};

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** An Excel workbook: text as inline strings, numbers as numbers. */
async function workbook(): Promise<Buffer> {
  const zip = new JSZip();
  const names = Object.keys(SHEETS);
  zip.file(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${names
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("")}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${names
      .map(
        (name, i) =>
          `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("")}</Relationships>`,
  );
  names.forEach((name, i) => {
    const rows = SHEETS[name]
      .map(
        (row) =>
          `<row>${row
            .map((value) =>
              typeof value === "number"
                ? `<c><v>${value}</v></c>`
                : `<c t="inlineStr"><is><t>${value}</t></is></c>`,
            )
            .join("")}</row>`,
      )
      .join("");
    zip.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<worksheet xmlns="${MAIN}"><sheetData>${rows}</sheetData></worksheet>`,
    );
  });
  return zip.generateAsync({ type: "nodebuffer" });
}

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}xlsx-to-table-${size}-${step}.png`,
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
    test("a new user opens one sheet of an Excel file from Files as a table", async () => {
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
          name: "Spring plan.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: await workbook(),
        });
      await page.getByRole("link", { name: "Spring plan.xlsx" }).click();
      const viewer = page.getByTestId("drive-file-viewer");
      await viewer.getByText("Harbour Deli").first().waitFor();
      await shot(page, size, "1-viewer");

      await viewer.getByRole("button", { name: "Open as table" }).click();
      const create = page.getByRole("dialog", { name: "New table" });
      const sheet = create.getByLabel("Sheet");
      await sheet.waitFor();
      assert.equal(
        await create.getByLabel("Title").inputValue(),
        "Spring plan",
      );
      await sheet.selectOption({ label: "Deliveries" });
      await create.getByText(/Oskar/).waitFor();
      assert.deepEqual(
        await create
          .getByRole("textbox", { name: "Column name" })
          .evaluateAll((inputs) =>
            inputs.map((input) => (input as HTMLInputElement).value),
          ),
        ["Shop", "Boxes", "Driver"],
      );
      await shot(page, size, "2-mapping");

      await create.getByRole("button", { name: "Create table" }).click();
      await page.waitForURL(/\/drive\/tables\//);
      const grid = page.getByRole("grid");
      await grid.getByText("Oskar").waitFor();
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
