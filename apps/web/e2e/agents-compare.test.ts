import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user compares three catalog Agents: pick them under their cards, see
// the bar clear the phone tab bar and a focused card under the bar scroll
// clear of it, open the table (no prices, ADR-0024; on phones arrow keys
// scroll the third column into view), then Clear by keyboard and land on
// Search agents. Free: nothing is hired.
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
    test("a new user compares three agents and clears them", async () => {
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

      // Pick three different Agents (one can sit in two category rows): click
      // the first toggle, then Tab and Enter onto the next unpicked ones.
      const toggles = page
        .locator('button[aria-label^="Compare "]')
        .filter({ visible: true });
      await toggles.first().click();
      let picked = 1;
      for (let tabs = 0; picked < 3 && tabs < 40; tabs++) {
        await page.keyboard.press("Tab");
        const onToggle = await page.evaluate(() => {
          const el = document.activeElement;
          return (
            el?.getAttribute("aria-label")?.startsWith("Compare ") === true &&
            el.getAttribute("aria-pressed") === "false"
          );
        });
        if (!onToggle) continue;
        await page.keyboard.press("Enter");
        picked++;
      }
      assert.equal(picked, 3, "Tab did not reach three Compare toggles");

      const clear = page.getByRole("button", { name: "Clear", exact: true });
      const open = page.getByRole("button", { name: "Compare 3" });
      await open.waitFor();
      // The bar: the box holding both the picked list and Clear (innermost).
      const bar = page
        .locator("div")
        .filter({ has: page.getByRole("list", { name: "Picked agents" }) })
        .filter({ has: clear })
        .last();
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

      // WCAG 2.4.11: a catalog card link that sits under the bar scrolls
      // clear of it once it has focus.
      const barBox = await bar.boundingBox();
      assert.ok(barBox, "no compare bar");
      // The element itself, not a selector: a card can repeat in two rows.
      const hidden = await page.evaluateHandle(
        ({ top, bottom }) =>
          [
            ...document.querySelectorAll<HTMLAnchorElement>(
              'main a[href^="/agents/"]',
            ),
          ].find((a) => {
            const r = a.getBoundingClientRect();
            return r.height > 0 && r.top < bottom && r.bottom > top;
          }) ?? null,
        { top: barBox.y, bottom: barBox.y + barBox.height },
      );
      const target = hidden.asElement();
      assert.ok(target, "no catalog card link under the bar to test");
      await target.focus();
      const [focusBox, barAfter] = await Promise.all([
        target.boundingBox(),
        bar.boundingBox(),
      ]);
      assert.ok(focusBox && barAfter);
      assert.equal(
        await target.evaluate((el) => el === document.activeElement),
        true,
        "the card under the bar did not take focus",
      );
      assert.ok(
        focusBox.y + focusBox.height <= barAfter.y,
        "the compare bar covers the focused card",
      );
      assert.ok(focusBox.y >= 0, "the focused card scrolled off the top");
      await shot(page, size, "1-picked");

      await open.click();
      const dialog = page.getByRole("dialog", { name: "Compare agents" });
      const table = dialog.getByRole("table", { name: "Compare agents" });
      await table.waitFor();
      for (const row of ["Rating", "Jobs run", "Made by", "What it does"])
        await table.getByRole("rowheader", { name: row }).waitFor();
      assert.equal(
        await table.getByRole("columnheader").count(),
        3,
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

      // Phones: three columns scroll sideways in the dialog. From the first
      // Agent link, arrow keys bring the clipped third column into view.
      if (size === "phone") {
        const scroller = await table.evaluateHandle((el) => el.parentElement);
        const third = table.getByRole("columnheader").nth(2);
        const clipped = () =>
          third.evaluate((el, box) => {
            const s = (box as HTMLElement).getBoundingClientRect();
            return el.getBoundingClientRect().right > s.right + 1;
          }, scroller);
        assert.equal(await clipped(), true, "three columns fit a phone");
        const firstLink = table
          .getByRole("columnheader")
          .first()
          .getByRole("link");
        for (let step = 0; step < 6; step++) {
          if (await firstLink.evaluate((el) => el === document.activeElement))
            break;
          await page.keyboard.press("Tab");
        }
        assert.equal(
          await firstLink.evaluate((el) => el === document.activeElement),
          true,
          "Tab did not reach the table",
        );
        // Chrome animates keyboard scrolling: let each press settle.
        const thirdHandle = await third.elementHandle();
        for (let step = 0; step < 8 && (await clipped()); step++) {
          await page.keyboard.press("ArrowRight");
          await page
            .waitForFunction(
              ([el, box]) =>
                (el as Element).getBoundingClientRect().right <=
                (box as Element).getBoundingClientRect().right + 1,
              [thirdHandle, scroller],
              { timeout: 500 },
            )
            .catch(() => {});
        }
        assert.equal(await clipped(), false, "arrow keys did not scroll");
        // Row labels stay in view while the columns scroll under them.
        const labelInView = await table
          .getByRole("rowheader", { name: "Rating" })
          .evaluate((el, box) => {
            const s = (box as HTMLElement).getBoundingClientRect();
            const r = el.getBoundingClientRect();
            return r.left >= s.left - 1 && r.right <= s.right + 1;
          }, scroller);
        assert.equal(labelInView, true, "row labels scrolled away");
      }

      // Keyboard only, as a person would: Escape returns focus to Compare N,
      // Shift+Tab reaches Clear.
      await page.keyboard.press("Escape");
      // Radix hands focus back after the dialog's exit animation.
      await page.waitForFunction(
        () => document.activeElement?.textContent?.trim() === "Compare 3",
      );
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
