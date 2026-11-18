import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user compares two catalog Agents: pick them under their cards, see
// the bar clear the phone tab bar, open the table (no prices, ADR-0024),
// then Clear by keyboard and land on Search agents. Free: nothing is hired.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}agents-compare-${size}-${step}.png`,
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
    test("a new user compares two agents and clears them", async () => {
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

      await page.goto(`${BASE_URL}/agents`);
      const search = page.getByRole("textbox", {
        name: "Search agents",
        exact: true,
      });
      await search.waitFor();

      // The same Agent can sit in two category rows; pick two different ones.
      const toggles = page
        .locator('button[aria-label^="Compare "]')
        .filter({ visible: true });
      await toggles.first().waitFor();
      const names = [
        ...new Set(
          await toggles.evaluateAll((els) =>
            els.map((el) => el.getAttribute("aria-label") ?? ""),
          ),
        ),
      ].slice(0, 2);
      assert.equal(names.length, 2, "fewer than two agents to compare");
      for (const name of names)
        await page.getByRole("button", { name, exact: true }).first().click();

      const clear = page.getByRole("button", { name: "Clear", exact: true });
      const open = page.getByRole("button", { name: "Compare 2" });
      await open.waitFor();
      // Nothing (the phone tab bar) covers the bar's buttons.
      for (const control of [clear, open]) {
        const covered = await control.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          return !el.contains(hit);
        });
        assert.equal(covered, false, "a compare bar button is covered");
      }
      await shot(page, size, "1-picked");

      await open.click();
      const dialog = page.getByRole("dialog", { name: "Compare agents" });
      const table = dialog.getByRole("table", { name: "Compare agents" });
      await table.waitFor();
      for (const row of ["Rating", "Jobs run", "Made by", "What it does"])
        await table.getByRole("rowheader", { name: row }).waitFor();
      assert.equal(
        await table.getByRole("columnheader").count(),
        2,
        "one column per picked agent",
      );
      // ADR-0024: no price row while app Hire is off.
      assert.equal(
        await table.getByRole("rowheader", { name: /price|credit/i }).count(),
        0,
        "the comparison shows a price",
      );
      // Layout width, not the transformed box: the open animation scales it.
      const margins = await dialog.evaluate(
        (el) => (window.innerWidth - (el as HTMLElement).offsetWidth) / 2,
      );
      assert.ok(margins >= 8, `dialog side margin is ${margins}px`);
      await shot(page, size, "2-table");

      // Keyboard only, as a person would: Escape returns focus to Compare N,
      // Shift+Tab reaches Clear.
      await page.keyboard.press("Escape");
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await clear.evaluate((el) => el === document.activeElement),
        true,
        "Shift+Tab from Compare did not reach Clear",
      );
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute("aria-label") ===
          "Search agents",
      );
      assert.equal(await open.count(), 0, "the bar stayed after Clear");
      await shot(page, size, "3-cleared");

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      await context.close();
      assert.equal(overflow, 0, `page overflows by ${overflow}px`);
      assert.deepEqual(errors, [], `page errors: ${errors.join("; ")}`);
    });
  });
}
