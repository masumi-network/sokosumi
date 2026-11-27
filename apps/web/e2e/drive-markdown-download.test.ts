import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import JSZip from "jszip";
import { type Browser, chromium, type Locator, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user downloads a Markdown file from Files as PDF and Word: upload an
// invented plan, open it from its row, work the Download menu by keyboard
// (Escape closes the menu, not the viewer), pick Export as PDF and Export as
// Word document, then do the same on the file's own page. Both copies are
// named after the file, and the original stays one item away. A file over the
// export limit keeps only the original and says why. Each size signs up its
// own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const MARKDOWN = [
  "# Launch plan",
  "",
  "| Week | Focus |",
  "| --- | --- |",
  "| 1 | Landing page |",
  "| 2 | Launch posts |",
].join("\n");
// Over the 1.5 MB export limit; one paragraph so the viewer renders it fast.
const OVERSIZED = `# Notes\n\n${"word ".repeat(340_000)}`;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function download(page: Page, scope: Locator, item: string) {
  await scope.getByRole("button", { name: "Download" }).click();
  const [file] = await Promise.all([
    page.waitForEvent("download", { timeout: 90_000 }),
    page.getByRole("menuitem", { name: item }).click(),
  ]);
  return file;
}

async function assertCopies(page: Page, scope: Locator) {
  const pdf = await download(page, scope, "Export as PDF");
  assert.equal(pdf.suggestedFilename(), "Launch plan.pdf");
  const pdfBytes = readFileSync(await pdf.path());
  assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");

  const word = await download(page, scope, "Export as Word document");
  assert.equal(word.suggestedFilename(), "Launch plan.docx");
  const xml = await (await JSZip.loadAsync(readFileSync(await word.path())))
    .file("word/document.xml")
    ?.async("string");
  assert.ok(xml?.includes("Launch plan"), "the Word file lost the heading");
  assert.ok(xml?.includes("<w:tbl>"), "the Word file has no table");
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
    test("a new user downloads a Markdown file as PDF and Word", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
        acceptDownloads: true,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}markdown-download-${size}-${step}.png`,
        });

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
          name: "Launch plan.md",
          mimeType: "text/markdown",
          buffer: Buffer.from(MARKDOWN),
        });
      const row = page.getByRole("link", { name: "Launch plan.md" });
      const detailHref = await row.getAttribute("href");
      await row.click();

      // The viewer a row opens, by keyboard first.
      const viewer = page.getByTestId("document-viewer");
      await viewer.getByRole("heading", { name: "Launch plan" }).waitFor();
      const trigger = viewer.getByRole("button", { name: "Download" });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const original = page.getByRole("menuitem", { name: "Original file" });
      await original.waitFor();
      assert.equal(await original.getAttribute("download"), "Launch plan.md");
      // Radix moves focus to the first item a moment after the menu opens.
      const focused = (name: string) =>
        page.waitForFunction(
          (text) => document.activeElement?.textContent === text,
          name,
          { timeout: 5_000 },
        );
      await focused("Original file");
      await page.keyboard.press("ArrowDown");
      await focused("Export as PDF");
      await shot("1-viewer-menu");
      await page.keyboard.press("Escape");
      await original.waitFor({ state: "detached" });
      assert.ok(
        await trigger.evaluate((el) => el === document.activeElement),
        "focus did not return to Download",
      );
      assert.ok(await viewer.isVisible(), "Escape closed the viewer too");
      await assertCopies(page, viewer);

      // The file's own page.
      assert.ok(detailHref, "the row has no link to the file's page");
      await page.goto(`${BASE_URL}${detailHref}`);
      const preview = page.getByTestId("file-preview");
      await preview.getByRole("heading", { name: "Launch plan" }).waitFor();
      await assertCopies(page, preview);
      await shot("2-detail");

      // A file over the limit: only the original, and the reason.
      await page.goto(`${BASE_URL}/drive?view=workspace`);
      await page
        .locator('input[type="file"]:not([webkitdirectory])')
        .first()
        .setInputFiles({
          name: "Big notes.md",
          mimeType: "text/markdown",
          buffer: Buffer.from(OVERSIZED),
        });
      await page.getByRole("link", { name: "Big notes.md" }).click();
      await viewer.getByRole("button", { name: "Download" }).click();
      await page.getByRole("menuitem", { name: "Original file" }).waitFor();
      for (const name of ["Export as PDF", "Export as Word document"]) {
        assert.equal(
          await page
            .getByRole("menuitem", { name })
            .getAttribute("aria-disabled"),
          "true",
          `${name} is not disabled`,
        );
      }
      await page.getByText("Too large to export as PDF or Word.").waitFor();
      await shot("3-too-large");

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
