import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user's empty Workspace offers Upload and New folder where it says
// files will appear; a new folder opens empty with the same two actions, and
// Upload there puts the file in it. An archived table offers Restore table in
// its notice, and its empty grid says rows come after restoring. Each size
// signs up its own disposable mail.tm inbox. Free actions only.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}drive-empty-${size}-${step}.png`,
  });
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
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
    test("empty Files and an archived table offer their next step in place", async () => {
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

      // Empty Workspace: both actions sit in the empty state.
      await page.goto(`${BASE_URL}/drive?view=workspace`);
      const main = page.getByRole("main");
      await main.getByText("Your files will appear here").waitFor();
      const upload = main.getByRole("button", { name: "Upload", exact: true });
      const newFolder = main.getByRole("button", { name: "New folder" });
      await upload.waitFor();
      await newFolder.waitFor();
      for (const button of [upload, newFolder]) {
        const box = await button.boundingBox();
        assert.ok(box && box.height >= 32, "empty-state action is tappable");
        assert.ok(
          box && box.x >= 0 && box.x + box.width <= viewport.width,
          "empty-state action is inside the viewport",
        );
      }
      await noSidewaysScroll(page);
      await shot(page, size, "1-workspace");

      // New folder lands in the folder, which offers the same actions.
      await newFolder.click();
      const create = page.getByRole("dialog", { name: "Create new folder" });
      await create.getByRole("textbox").fill("E2E receipts");
      await create.getByRole("button", { name: "Create" }).click();
      await create.waitFor({ state: "hidden" });
      await page.waitForURL(/folder=E2E/);
      await main.getByText("Nothing in this folder yet").waitFor();
      await shot(page, size, "2-folder");

      // Upload from the empty folder puts the file in that folder.
      const chooser = page.waitForEvent("filechooser");
      await main.getByRole("button", { name: "Upload", exact: true }).click();
      await (await chooser).setFiles({
        name: "e2e-note.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Invented note for an end-to-end test.\n"),
      });
      await main.getByText("e2e-note.txt").first().waitFor();
      assert.match(page.url(), /folder=E2E\+receipts|folder=E2E%20receipts/);

      // An archived table restores from its notice.
      await page.goto(`${BASE_URL}/drive?view=tables`);
      await page.getByRole("tab", { name: "Tables", selected: true }).waitFor();
      await page.getByRole("button", { name: "New table" }).click();
      const newTable = page.getByRole("dialog", { name: "New table" });
      await newTable.getByRole("textbox", { name: "Title" }).fill("E2E stock");
      await newTable.getByRole("button", { name: "Create table" }).click();
      await page.waitForURL(/\/drive\/tables\//);
      await page.getByRole("heading", { name: "E2E stock" }).waitFor();
      await page.getByRole("button", { name: "Table options" }).click();
      await page.getByRole("menuitem", { name: "Archive table" }).click();
      const archive = page.getByRole("dialog", { name: "Archive table" });
      await archive.getByRole("button", { name: "Archive table" }).click();
      await archive.waitFor({ state: "hidden" });

      await main
        .getByText("This table is archived, so it is read-only.")
        .waitFor();
      await main.getByText("No rows. Restore the table to add some.").waitFor();
      const restore = main.getByRole("button", { name: "Restore table" });
      const box = await restore.boundingBox();
      assert.ok(box && box.height >= 32, "Restore table is tappable");
      await noSidewaysScroll(page);
      await shot(page, size, "3-archived");

      await restore.click();
      const confirm = page.getByRole("dialog", { name: "Restore table" });
      await confirm.getByRole("button", { name: "Restore table" }).click();
      await confirm.waitFor({ state: "hidden" });
      await main
        .getByText("This table is archived, so it is read-only.")
        .waitFor({ state: "hidden" });
      assert.ok(
        await main.getByRole("button", { name: "Add row" }).isEnabled(),
        "the restored table is editable",
      );
      await shot(page, size, "4-restored");

      await context.close();
      assert.deepEqual(errors, []);
    });
  });
}
