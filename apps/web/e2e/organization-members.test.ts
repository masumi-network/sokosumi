import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Locator, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

/**
 * A new owner opens their Organization: Members is a card with its count,
 * Invite and a search that finds them by name and by email, with their role
 * on screen at every size. Delete on their only workspace says plainly it
 * can't happen yet and offers only Close, with no name to type.
 * Free only: nothing is sent, saved or deleted.
 */
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
    path: `${RESULTS_DIR}organization-members-${size}-${step}.png`,
  });
}

async function assertNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 1, `page is ${overflow}px wider than the screen`);
}

async function assertInside(locator: Locator, width: number, label: string) {
  const box = await locator.boundingBox();
  assert.ok(box, `${label} is on screen`);
  assert.ok(box.x >= 0, `${label} starts at ${box.x}`);
  assert.ok(
    box.x + box.width <= width,
    `${label} ends at ${box.x + box.width} on a ${width}px screen`,
  );
}

for (const { name, isMobile, ...viewport } of PROJECTS) {
  describe(name, () => {
    let browser: Browser;
    before(async () => {
      mkdirSync(RESULTS_DIR, { recursive: true });
      browser = await chromium.launch();
    });
    after(() => browser.close());

    test("Members card searches and fits; blocked Delete offers only Close", async () => {
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

      const members = page.locator("#members");
      await members
        .getByRole("heading", { level: 2, name: /^Members\s*1$/ })
        .waitFor();
      await members.getByRole("button", { name: "Invite member" }).waitFor();
      const search = members.getByRole("searchbox", { name: "Search members" });

      const row = members.getByRole("row").filter({ hasText: "Ada Tester" });
      await row.waitFor();
      await assertInside(row.getByText("Owner"), viewport.width, "Owner role");
      const email = (await row.innerText()).match(/\S+@\S+/)?.[0];
      assert.ok(email, "the owner's row shows their email");
      const status = members.getByRole("status");

      // Each search starts from no match, so a row that returns proves the
      // query found it.
      for (const query of ["Ada Tester", email]) {
        await search.fill("nobody-by-this-name");
        await members.getByText("No results.").waitFor();
        await row.waitFor({ state: "detached" });
        assert.equal(await status.textContent(), "No members match");
        await search.fill(query);
        await row.waitFor();
        assert.equal(await status.textContent(), "1 match");
      }
      await search.fill("");
      await row.waitFor();
      if (name !== "desktop") {
        // Phones and tablets hide Email and Last seen; their sorts live in Sort.
        await members.getByRole("button", { name: "Sort" }).click();
        await page
          .getByRole("menuitemradio", { name: "Email, descending" })
          .click();
        await row.waitFor();
      }
      await members.scrollIntoViewIfNeeded();
      await assertNoOverflow(page);
      await shot(page, name, "members");

      await page.getByRole("button", { name: "Delete", exact: true }).click();
      const dialog = page.getByRole("alertdialog", {
        name: `${ORGANIZATION} can't be deleted yet`,
      });
      await dialog.waitFor();
      await dialog.getByText("It's your only workspace").waitFor();
      assert.equal(await dialog.getByRole("textbox").count(), 0);
      assert.deepEqual(await dialog.getByRole("button").allInnerTexts(), [
        "Close",
      ]);
      await assertNoOverflow(page);
      await shot(page, name, "delete-blocked");
      await dialog.getByRole("button", { name: "Close" }).click();
      await dialog.waitFor({ state: "hidden" });

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
