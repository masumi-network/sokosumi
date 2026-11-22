import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user's only Project, hidden: the Open view says it has no open
// projects and links to Hidden, instead of claiming there are none. On the
// way, the brand card's two actions are the same size on a phone. Each size
// signs up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const PROJECT = "E2E bakery spring";

const SIZES = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}projects-phone-${size}-${step}.png`,
  });
}

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  console.log(`E2E_BASE_URL=${BASE_URL}`);
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name: size, isMobile, ...viewport } of SIZES) {
  describe(size, () => {
    test("a hidden only project leaves Open pointing to Hidden", async () => {
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

      // The brand card's two actions match: on a phone both are 40px tall
      // and as wide as the column.
      const generate = await page
        .getByRole("button", { name: "Generate from website" })
        .boundingBox();
      const upload = await page
        .getByRole("button", { name: "Upload" })
        .boundingBox();
      assert.ok(generate && upload, "both brand actions are on screen");
      assert.equal(
        upload.height,
        generate.height,
        "Upload as tall as Generate",
      );
      if (size === "phone") {
        assert.equal(upload.height, 40);
        assert.equal(
          upload.width,
          generate.width,
          "Upload as wide as Generate",
        );
      }
      await shot(page, size, "brand-actions");

      await page.goto(`${BASE_URL}/projects`);
      const card = page.getByRole("article").filter({ hasText: PROJECT });
      await card.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Hide" }).click();
      await card.waitFor({ state: "detached" });
      // The card leaves at once; "No open projects" only renders once the
      // Hide is saved and the page re-reads Core (an optimistic empty list
      // still says "No projects yet"). Then a reload shows it was kept.
      const noOpen = page.getByRole("heading", { name: "No open projects" });
      await noOpen.waitFor();
      await page.reload();
      await noOpen.waitFor();
      assert.equal(
        await page.getByRole("heading", { name: "No projects yet" }).count(),
        0,
      );
      await shot(page, size, "open-empty-hidden");
      await page.getByRole("link", { name: "Show hidden projects" }).click();
      await page.waitForURL(/\/projects\?state=hidden$/);
      await card.waitFor();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      assert.equal(overflow, false, "no sideways page scroll");
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
