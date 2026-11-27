import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user adds an invented README.md to their Files root and reads it at
// the top of the folder: clamped with Show more, opened in the
// viewer, and gone while searching the whole workspace. Each size signs up its
// own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const README = [
  "# Client work",
  "",
  "Everything for client projects lives here.",
  "",
  "## Where things go",
  "",
  "- **Briefs**: one file per client.",
  "- **Drafts**: work in progress.",
  "- **Final**: only approved files.",
  "",
  "## Naming",
  "",
  "Use `client-topic-date`.",
  "",
  "## Questions",
  "",
  "Ask in the team channel before you move anything.",
].join("\n");

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}folder-readme-${size}-${step}.png`,
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
    test("a new user reads a folder's README above its files", async () => {
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
      const files = page.locator('input[type="file"]:not([webkitdirectory])');
      await files.first().setInputFiles({
        name: "orders.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("Shop,Orders\nCorner Bakery,12\n"),
      });
      await page.getByRole("link", { name: "orders.csv" }).waitFor();
      const card = page.getByRole("region", { name: "About this folder" });
      assert.equal(await card.count(), 0, "no README, no card");

      await files.first().setInputFiles({
        name: "README.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(README),
      });
      await card.getByRole("heading", { name: "Where things go" }).waitFor();
      // The file itself stays in the list.
      await page.getByRole("link", { name: "README.md" }).waitFor();
      await shot(page, size, "1-card");

      const more = card.getByRole("button", { name: "Show more" });
      assert.equal(await more.getAttribute("aria-expanded"), "false");
      await more.click();
      await card.getByRole("button", { name: "Show less" }).waitFor();
      await shot(page, size, "2-expanded");

      await card.getByRole("button", { name: "Open" }).click();
      const viewer = page.getByRole("dialog", { name: "README.md" });
      await viewer.getByRole("heading", { name: "Naming" }).waitFor();
      await shot(page, size, "3-viewer");
      await page.keyboard.press("Escape");
      await viewer.waitFor({ state: "hidden" });

      await page.getByRole("searchbox").fill("orders");
      await page.getByRole("searchbox").press("Enter");
      await card.waitFor({ state: "detached" });

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
