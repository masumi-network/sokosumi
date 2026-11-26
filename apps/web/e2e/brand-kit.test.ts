import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";

import JSZip from "jszip";
import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user hands their brand to a designer: create a Project, upload an
// invented DESIGN.md, open the Design tab and Download brand kit. The zip is
// named after the Project and holds the DESIGN.md as written plus its colours
// and type as plain text. A Project with no website has no logo, so none is
// in the zip. Each size signs up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const PROJECT = "E2E bakery";
const DESIGN_MD =
  "---\ncolors:\n  primary: '#2F7D4F'\ntypography:\n  display:\n    fontFamily: Inter\n    fontSize: 30px\n---\n## Voice\n\nWarm photos, plain words.\n";

const SIZES = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  console.log(`E2E_BASE_URL=${BASE_URL}`);
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name: size, isMobile, ...viewport } of SIZES) {
  describe(size, () => {
    test("a new user downloads a project's brand kit", async () => {
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

      await page.goto(`${BASE_URL}/projects`);
      await page.getByRole("heading", { name: "No projects yet" }).waitFor();
      await page
        .getByRole("button", { name: /^(New project|Create project)$/ })
        .filter({ visible: true })
        .first()
        .click();
      const wizard = page.getByRole("dialog", { name: "New project" });
      await wizard.getByLabel("Project name").fill(PROJECT);
      await wizard.getByRole("button", { name: "Continue" }).click();
      await wizard.getByRole("button", { name: "Continue" }).click();
      await wizard.getByRole("button", { name: "Create project" }).click();
      await page.waitForURL(/\/projects\/[^/?]+$/);
      await page.getByRole("heading", { level: 1, name: PROJECT }).waitFor();

      await page.getByRole("button", { name: "Upload" }).click();
      await page.locator('input[type="file"]').setInputFiles({
        name: "DESIGN.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(DESIGN_MD),
      });
      await page.getByText("Ready").waitFor();

      await page
        .getByRole("navigation", { name: "Project sections" })
        .getByRole("link", { name: "Design" })
        .click();
      await page.waitForURL(/\/design-md$/);
      const button = page.getByRole("button", { name: "Download brand kit" });
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        button.click(),
      ]);
      await page.screenshot({
        path: `${RESULTS_DIR}brand-kit-${size}.png`,
      });

      assert.equal(download.suggestedFilename(), `${PROJECT} brand kit.zip`);
      const path = await download.path();
      const zip = await JSZip.loadAsync(await readFile(path));
      assert.deepEqual(Object.keys(zip.files).sort(), [
        "DESIGN.md",
        "brand.txt",
      ]);
      // Core stores the upload without its trailing newline; the zip carries
      // the stored file as is.
      assert.equal(
        (await zip.file("DESIGN.md")?.async("string"))?.trimEnd(),
        DESIGN_MD.trimEnd(),
      );
      assert.equal(
        await zip.file("brand.txt")?.async("string"),
        "Colors\nprimary: #2F7D4F\n\nTypography\ndisplay: Inter · 30px\n",
      );
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
