import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user's first Project, end to end: create it, upload a long DESIGN.md,
// edit it with the toolbar and Save in view and the editor named, then open
// Close from the project menu and keep the project open, with no menu left
// behind. Each size signs up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const PROJECT = "E2E bakery launch";
// Long enough that an unbounded editor runs past the screen at every size.
const DESIGN_MD = `# Bakery\n\n${Array.from(
  { length: 120 },
  (_, i) => `- Rule ${i + 1}: warm photos, plain words.`,
).join("\n")}\n`;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({ path: `${RESULTS_DIR}projects-${size}-${step}.png` });
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
    test("a new user creates a project, edits its DESIGN.md and keeps it open", async () => {
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

      await page.goto(`${BASE_URL}/projects`);
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

      await page.getByRole("button", { name: "Brand actions" }).click();
      await page.getByRole("menuitem", { name: "Edit" }).click();
      await page.waitForURL(/\/design-md\/edit$/);
      const editor = page
        .getByRole("textbox", { name: "Edit DESIGN.md" })
        .filter({ visible: true });
      await editor.waitFor();
      const save = page.getByRole("button", { name: "Save" });
      const editorBox = await editor.boundingBox();
      const saveBox = await save.boundingBox();
      assert.ok(editorBox && saveBox, "editor and Save are on screen");
      // The editor scrolls inside itself: it ends above the Save bar and the
      // Save bar stays on the screen.
      assert.ok(
        editorBox.y + editorBox.height <= saveBox.y,
        `editor ends at ${editorBox.y + editorBox.height}, Save starts at ${saveBox.y}`,
      );
      assert.ok(saveBox.y + saveBox.height <= viewport.height);
      await shot(page, size, "design-md-edit");

      await page.getByRole("button", { name: "Cancel" }).click();
      await page.waitForURL(/\/design-md$/);

      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Close" }).click();
      const confirm = page.getByRole("alertdialog", { name: "Close project?" });
      await confirm.waitFor();
      assert.equal(await page.getByRole("menu").count(), 0);
      await confirm.getByRole("button", { name: "Keep project open" }).click();
      await confirm.waitFor({ state: "detached" });
      assert.equal(await page.getByRole("menu").count(), 0);
      await shot(page, size, "kept-open");

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      assert.equal(overflow, false, "no sideways page scroll");
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
