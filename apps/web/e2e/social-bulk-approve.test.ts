import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";

// A user approves two posts waiting in Social's Drafts in one step. With no
// time and no account each approved post becomes a draft, so nothing can be
// published.
//
// The spec signs up nobody and never messages a Soko Bot: a bot turn calls a
// paid model. Only a Soko Bot or a Coworker (which needs a vendor workspace
// grant) creates a post that waits for approval, and Core has no test-only
// route that seeds one. So the spec runs only against a prepared fixture and
// is skipped otherwise:
//   E2E_SOCIAL_APPROVAL_STORAGE_STATE  Playwright storage state of a
//                                      disposable test user on that preview.
//   E2E_SOCIAL_APPROVAL_PROJECT        A Project of that user with at least
//                                      two waiting posts per size (six), each
//                                      with no time and no account.
// The target must be an isolated PR preview (*.preview.sokosumi.com).
const STORAGE_STATE = process.env.E2E_SOCIAL_APPROVAL_STORAGE_STATE;
const PROJECT = process.env.E2E_SOCIAL_APPROVAL_PROJECT;
const SKIP =
  STORAGE_STATE && PROJECT
    ? false
    : "needs E2E_SOCIAL_APPROVAL_STORAGE_STATE and E2E_SOCIAL_APPROVAL_PROJECT";
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

let browser: Browser | undefined;
let baseUrl = "";
before(async () => {
  if (SKIP) return;
  baseUrl = resolveBaseUrl(process.env);
  assert.match(
    new URL(baseUrl).hostname,
    /\.preview\.sokosumi\.com$/,
    "run this spec only against an isolated PR preview",
  );
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
});
after(() => browser?.close());

for (const { name, ...viewport } of PROJECTS) {
  describe(name, () => {
    test("approves two waiting posts at once", { skip: SKIP }, async () => {
      assert.ok(browser && STORAGE_STATE && PROJECT);
      const context = await browser.newContext({
        viewport,
        storageState: STORAGE_STATE,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}social-bulk-approve-${name}-${step}.png`,
        });
      const main = page.getByRole("main");

      await page.goto(`${baseUrl}/social?tab=drafts`);
      await main.getByRole("button", { name: "Select project" }).click();
      await page
        .getByRole("combobox", { name: "Find a project..." })
        .fill(PROJECT);
      await page.keyboard.press("Enter");
      const approveSelected = main.getByRole("button", {
        name: "Approve selected",
      });
      await approveSelected.waitFor();
      assert.equal(await approveSelected.isDisabled(), true);
      await shot("1-waiting");

      // Each checkbox names its post and position.
      const boxes = main.getByRole("checkbox", {
        name: /^Select post \d+ of \d+ to approve: /,
      });
      assert.ok((await boxes.count()) >= 2, "the fixture has too few posts");
      for (const box of (await boxes.all()).slice(0, 2)) {
        const size = await box.boundingBox();
        assert.ok(size);
        // Phone and tablet get a 24px box; desktop keeps 16px.
        assert.ok(
          size.width >= (name === "desktop" ? 16 : 24),
          `the checkbox is ${size.width}px wide`,
        );
        await box.click();
      }
      await main.getByText("2 selected").waitFor();
      await approveSelected.click();

      const dialog = page.getByRole("alertdialog");
      await dialog.getByRole("heading", { name: "Approve 2 posts?" }).waitFor();
      assert.equal(await dialog.getByText("Becomes a draft").count(), 2);
      assert.ok(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
        "the confirmation is wider than the screen",
      );
      await shot("2-confirm");
      await dialog.getByRole("button", { name: "Approve selected" }).click();

      await dialog.getByRole("heading", { name: "Approval results" }).waitFor();
      assert.equal(await dialog.getByText("Approved as a draft").count(), 2);
      await shot("3-results");
      await dialog.getByRole("button", { name: "Close" }).click();
      await shot("4-after");

      await context.close();
      assert.deepEqual(errors, []);
    });
  });
}
