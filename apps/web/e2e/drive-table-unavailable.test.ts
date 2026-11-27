import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

// A new user's table, then the same page after a workspace switch: the
// archive dialog names its action, and a table that is not in the active
// workspace says so at once with a way back, instead of "Loading…" for a
// minute and a Retry that cannot work. Each size signs up its own
// disposable mail.tm inbox. Free actions only.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const ORGANIZATION = "Ada Test Studio";

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}drive-table-${size}-${step}.png`,
  });
}

/** Opens the workspace menu wherever this width puts it and picks Personal. */
async function switchToPersonal(page: Page) {
  const rail = page.getByRole("button", { name: "Switch organisation" });
  if (await rail.isVisible()) {
    await rail.click();
  } else {
    const show = page.getByRole("button", { name: "Show sidebar" });
    if (await show.isVisible()) await show.click();
    await page.getByRole("button", { name: ORGANIZATION, exact: true }).click();
  }
  await page.getByRole("menuitem", { name: /^Personal\b/ }).click();
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
    test("a table from another workspace says so at once and leads back to Files", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await signUpWithOrganization(page, BASE_URL);

      await page.goto(`${BASE_URL}/drive?view=tables`);
      await page.getByRole("button", { name: "New table" }).click();
      const create = page.getByRole("dialog", { name: "New table" });
      await create.getByRole("textbox", { name: "Title" }).fill("E2E prices");
      await create.getByRole("button", { name: "Create table" }).click();
      await page.waitForURL(/\/drive\/tables\//);
      await page.getByRole("heading", { name: "E2E prices" }).waitFor();

      // Archiving is confirmed with its own name, not "Save".
      await page.getByRole("button", { name: "Table options" }).click();
      await page.getByRole("menuitem", { name: "Archive table" }).click();
      const archive = page.getByRole("dialog", { name: "Archive table" });
      await archive.getByRole("button", { name: "Archive table" }).waitFor();
      assert.equal(
        await archive.getByRole("button", { name: "Save" }).count(),
        0,
      );
      await shot(page, size, "1-archive-dialog");
      await page.keyboard.press("Escape");
      await archive.waitFor({ state: "hidden" });

      await switchToPersonal(page);
      const startedAt = Date.now();
      await page
        .getByRole("heading", { name: "Can't open this table" })
        .waitFor({ timeout: 20_000 });
      assert.ok(
        Date.now() - startedAt < 20_000,
        "the missing table is reported without a minute of Loading",
      );
      // Asking again cannot bring it back, so there is no Retry.
      assert.equal(
        await page.getByRole("button", { name: "Retry" }).count(),
        0,
      );
      const back = page.getByRole("main").getByRole("link", {
        name: "Back to Files",
      });
      const box = await back.boundingBox();
      assert.ok(box && box.height >= 24, "Back to Files is a full tap target");
      assert.ok(
        box && box.x >= 0 && box.x + box.width <= viewport.width,
        "Back to Files is inside the viewport",
      );
      await shot(page, size, "2-unavailable");

      await back.click();
      await page.waitForURL(/\/drive\?view=tables/);
      await page.getByRole("tab", { name: "Tables", selected: true }).waitFor();

      await context.close();
      assert.deepEqual(errors, []);
    });
  });
}
