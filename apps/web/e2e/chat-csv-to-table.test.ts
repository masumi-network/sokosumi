import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

// A new user turns a CSV shared in chat into a Table: create a channel, post
// an invented CSV, Open as table on the message, check the mapping and
// preview (a leading-zero code stays text), create, and find the rows in the
// Table. Each size signs up its own disposable mail.tm inbox, unless
// E2E_STORAGE_STATE holds a signed-in disposable user's Playwright storage
// state (create it per run, never commit it): then nobody signs up and the
// CSV goes to that user's own notes chat.
const BASE_URL = resolveBaseUrl(process.env);
const STORAGE_STATE = process.env.E2E_STORAGE_STATE?.trim();
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
    path: `${RESULTS_DIR}chat-csv-to-table-${size}-${step}.png`,
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
    test("a new user opens a CSV from chat as a table", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
        storageState: STORAGE_STATE || undefined,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      if (STORAGE_STATE) {
        // Phones list chats at /chat. From md there is no list page: the
        // sidebar lists them, and a tablet keeps it folded away.
        await page.goto(`${BASE_URL}${viewport.width < 768 ? "/chat" : "/"}`);
        const own = page.getByRole("link", { name: /\(you\)/ }).first();
        const showSidebar = page.getByRole("button", { name: "Show sidebar" });
        await own.or(showSidebar).first().waitFor();
        if (await showSidebar.isVisible()) await showSidebar.click();
        await own.click();
      } else {
        await signUpWithOrganization(page, BASE_URL);
        await page.goto(`${BASE_URL}/chat/catch-up`);
        await page.getByRole("button", { name: "Create a channel" }).click();
        // Typed, not filled: the name drives the link and an availability check.
        await page
          .getByRole("textbox", { name: "Name" })
          .pressSequentially("Shop List", { delay: 30 });
        await page.getByRole("button", { name: "Next" }).click();
        await page.getByRole("button", { name: "Create" }).click();
      }
      await page.waitForURL(/\/chat\/rooms\//);

      await page.getByRole("button", { name: "Attach file" }).click();
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("menuitem", { name: "Upload from device" }).click();
      await (await chooser).setFiles({
        name: "shops.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(CSV),
      });
      // Send stays disabled until the upload lands as a chip.
      await page.getByRole("button", { name: "Remove shops.csv" }).waitFor();
      const openAsTable = page.getByRole("button", { name: "Open as table" });
      const earlier = await openAsTable.count();
      await page.getByRole("button", { name: "Send message" }).click();
      // The notes chat keeps earlier runs' CSVs: this one adds the next button.
      const open = openAsTable.nth(earlier);
      await open.waitFor();
      await shot(page, size, "1-message");

      await open.click();
      const create = page.getByRole("dialog", { name: "New table" });
      // A column row lists its first values: the Zip code kept its zero.
      await create.getByText(/01067/).waitFor();
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
      const grid = page.getByRole("grid");
      await grid.getByText("Harbour Deli").waitFor();
      await grid.getByText("04109").waitFor();
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
