import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user combines two PDFs in Files: upload two invented PDFs, select
// both, put the second first, name the result and download it. Files keeps
// only the two originals. Each size signs up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

/** A valid PDF with one line of text per page, written by hand. */
function syntheticPdf(lines: string[]): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${lines.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${lines.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const [i, line] of lines.entries()) {
    const text = `BT /F1 24 Tf 60 760 Td (${line}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    );
  }
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => {
    const at = body.length;
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets)
    body += `${String(at).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}combine-pdf-${size}-${step}.png`,
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
    test("a new user combines two PDFs in Files", async () => {
      const context = await browser.newContext({
        acceptDownloads: true,
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
        .setInputFiles([
          {
            name: "cover-letter.pdf",
            mimeType: "application/pdf",
            buffer: syntheticPdf(["Cover letter (demo)"]),
          },
          {
            name: "price-list.pdf",
            mimeType: "application/pdf",
            buffer: syntheticPdf([
              "Price list (demo) 1",
              "Price list (demo) 2",
            ]),
          },
        ]);
      for (const name of ["cover-letter.pdf", "price-list.pdf"])
        await page.getByRole("checkbox", { name: `Select ${name}` }).click();
      await page.getByRole("button", { name: "Combine PDFs" }).click();

      const dialog = page.getByRole("dialog", { name: "Combine 2 PDFs" });
      await dialog
        .getByRole("button", { name: "Move cover-letter.pdf down" })
        .click();
      const order = await dialog.getByRole("listitem").allInnerTexts();
      assert.match(order[0], /price-list\.pdf/);
      await dialog.getByLabel("File name").fill("Pack");
      await shot(page, size, "1-order");

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        dialog.getByRole("button", { name: "Download" }).click(),
      ]);
      assert.equal(download.suggestedFilename(), "Pack.pdf");
      // pdf-lib copies page content streams as they are, so the text stays
      // readable in the bytes and shows the page order.
      const pdf = readFileSync(await download.path()).toString("latin1");
      assert.ok(pdf.startsWith("%PDF-"));
      const at = [
        "Price list (demo) 1",
        "Price list (demo) 2",
        "Cover letter (demo)",
      ].map((text) => pdf.indexOf(text));
      assert.ok(at[0] >= 0 && at[0] < at[1] && at[1] < at[2], `order ${at}`);
      await page.getByText("Downloaded Pack.pdf").waitFor();
      await dialog.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Combine PDFs" }).waitFor();
      assert.ok(
        await page
          .getByRole("button", { name: "Combine PDFs" })
          .evaluate((button) => button === document.activeElement),
        "focus returns to Combine PDFs",
      );
      for (const name of ["cover-letter.pdf", "price-list.pdf"])
        await page.getByRole("link", { name }).waitFor();
      assert.equal(
        await page.getByRole("link", { name: "Pack.pdf" }).count(),
        0,
      );
      await shot(page, size, "2-downloaded");

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
