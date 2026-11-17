import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user saves an SEO Audit, tracks two keywords by hand and copies them
// into a Files table. Saving pages and keywords is free; no check runs.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];
const KEYWORDS = ["handmade ceramic mugs", "stoneware coffee cup"];

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name, ...viewport } of PROJECTS) {
  describe(name, () => {
    test("a new user copies tracked keywords into a Files table", async () => {
      const mailbox = await createMailbox();
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}seo-table-${name}-${step}.png`,
        });

      await page.goto(`${BASE_URL}/`);
      await page.getByRole("link", { name: "Register" }).click();
      // Typed before the form hydrates, the address is lost.
      await page.waitForURL(/\/signup/);
      await page
        .getByRole("main")
        .getByRole("heading", { name: "Create your account" })
        .waitFor();
      await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByRole("textbox", { name: "First name" }).fill("Ada");
      await page.getByRole("textbox", { name: "Last name" }).fill(name);
      await page
        .getByRole("textbox", { name: "Code from the email" })
        .pressSequentially(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/signup"));

      // SEO asks for a workspace first; the Soko Bot can wait.
      await page.goto(`${BASE_URL}/seo`);
      await page.waitForURL(/\/setup/);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("link", { name: "Later" }).click();

      await page
        .getByRole("textbox", { name: "First page URL" })
        .fill("https://example.com/");
      await page.getByRole("textbox", { name: "Audit name" }).fill("Demo shop");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("tab", { name: "Rankings" }).click();

      for (const keyword of KEYWORDS) {
        await page.getByRole("button", { name: "Add a keyword" }).click();
        const dialog = page.getByRole("dialog", { name: "Track a keyword" });
        await dialog.getByRole("textbox", { name: "Keyword" }).fill(keyword);
        // The market is picked by name since #7365.
        await dialog.getByRole("combobox", { name: "Search country" }).click();
        await page
          .getByRole("option", { name: "United States", exact: true })
          .click();
        await dialog.getByRole("combobox", { name: "Search language" }).click();
        await page
          .getByRole("option", { name: "English", exact: true })
          .click();
        await dialog.getByRole("button", { name: "Save" }).click();
        await dialog.waitFor({ state: "hidden" });
      }

      const copy = page.getByRole("button", {
        name: "Copy to a table: Keywords",
      });
      // The copy holds the keyword lists only: Competitors hides it.
      await page.getByRole("button", { name: "Competitors" }).click();
      await copy.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Keywords", exact: true }).click();
      await copy.click();
      await page.getByText("2 keywords copied to a new table.").waitFor();
      await shot("1-copied");

      await page.getByRole("button", { name: "Open table" }).click();
      await page.waitForURL(/\/drive\/tables\//);
      await page
        .getByRole("heading", { level: 1, name: /^Keywords · Demo shop · / })
        .waitFor();
      for (const keyword of KEYWORDS)
        await page.getByRole("gridcell").filter({ hasText: keyword }).waitFor();
      await shot("2-table");

      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        true,
        "no horizontal overflow",
      );
      await context.close();
      assert.deepEqual(errors, []);
    });
  });
}
