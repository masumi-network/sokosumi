import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

/**
 * A new owner renames their Organization to a long name and checks that Edit
 * and Delete stay whole on the screen. Then they open the brand guide
 * (DESIGN.md, generated from example.com at setup), type a line, Cancel and
 * Discard it: Edit opens the saved file again, not the discarded line.
 * Free only: setup's brand generation and a rename; nothing is saved to the
 * DESIGN.md.
 */
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
// Near the 50-character limit for an Organization name.
const LONG_NAME = "Ada's Neighbourhood Bakery and Coffee Roastery";
const DISCARDED = "Discarded brand rule";

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}organization-design-md-${size}-${step}.png`,
  });
}

async function assertNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 1, `page is ${overflow}px wider than the screen`);
}

/** Opens DESIGN.md `…` › Edit; a page refresh can close the menu, so retry. */
async function openDesignMdEditor(page: Page) {
  for (let attempt = 1; ; attempt++) {
    await page.getByRole("button", { name: "Open DESIGN.md actions" }).click();
    try {
      await page
        .getByRole("menuitem", { name: "Edit" })
        .click({ timeout: 5_000 });
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      await page.keyboard.press("Escape");
    }
  }
  await page.waitForURL(/\/organizations\/[^/]+\/design-md\/edit$/);
  const editor = page
    .getByRole("textbox", { name: "Edit DESIGN.md" })
    .filter({ visible: true });
  await editor.waitFor();
  return editor;
}

for (const { name, isMobile, ...viewport } of PROJECTS) {
  describe(name, () => {
    let browser: Browser;
    before(async () => {
      mkdirSync(RESULTS_DIR, { recursive: true });
      browser = await chromium.launch();
    });
    after(() => browser.close());

    test("Edit and Delete fit a long name; Edit after Discard opens the saved DESIGN.md", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await signUpWithOrganization(page, BASE_URL);
      await page.goto(`${BASE_URL}/organization`);

      await page.getByRole("button", { name: "Edit", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Edit organization" });
      await dialog.getByRole("textbox", { name: "Name" }).fill(LONG_NAME);
      await dialog.getByRole("button", { name: "Save" }).click();
      await page.getByRole("heading", { level: 1, name: LONG_NAME }).waitFor();

      // Setup generates the DESIGN.md in the background.
      const attached = page.getByText("DESIGN.md attached to this profile");
      for (let attempt = 1; !(await attached.isVisible()); attempt++) {
        assert.ok(attempt <= 36, "DESIGN.md was not generated in 3 minutes");
        await page.waitForTimeout(5_000);
        await page.reload();
      }

      const editor = await openDesignMdEditor(page);
      const saved = await editor.innerText();
      await editor.click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.press("Enter");
      await page.keyboard.type(DISCARDED);
      await page.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: "Discard changes" }).click();
      await page.waitForURL(/\/organizations\/[^/]+$/);

      // The owner's actions sit whole inside the screen, beside or below the
      // long name.
      await page.getByRole("heading", { level: 1, name: LONG_NAME }).waitFor();
      for (const label of ["Edit", "Delete"]) {
        const box = await page
          .getByRole("button", { name: label, exact: true })
          .boundingBox();
        assert.ok(box, `${label} is on screen`);
        assert.ok(box.x >= 0, `${label} starts at ${box.x}`);
        assert.ok(
          box.x + box.width <= viewport.width,
          `${label} ends at ${box.x + box.width} on a ${viewport.width}px screen`,
        );
      }
      await assertNoOverflow(page);
      await shot(page, name, "organization");

      const reopened = await openDesignMdEditor(page);
      assert.equal(await reopened.innerText(), saved);
      assert.ok(!(await reopened.innerText()).includes(DISCARDED));
      assert.equal(
        await page.getByRole("button", { name: "Save" }).isEnabled(),
        false,
        "nothing to save on a fresh Edit",
      );
      await assertNoOverflow(page);
      await shot(page, name, "design-md-reopened");

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
