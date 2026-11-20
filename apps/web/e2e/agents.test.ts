import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user finds an agent with the Agents page's one search, reads its
// profile and opens New task from it (cancelled; nothing is created or spent).
// The profile keeps the app's side gutter at every size, and its Find field
// shows below the header (on a phone it once sat under the top bar).
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const GUTTER = 12;

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  console.log(`E2E_BASE_URL=${BASE_URL}`);
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name: size, ...viewport } of PROJECTS) {
  describe(size, () => {
    test("a new user opens an agent's profile from the gallery", async () => {
      const mailbox = await createMailbox();
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({ path: `${RESULTS_DIR}agents-${size}-${step}.png` });

      await page.goto(`${BASE_URL}/signup`);
      await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByRole("textbox", { name: "First name" }).fill("E2E");
      await page.getByRole("textbox", { name: "Last name" }).fill("Agents");
      await page
        .getByRole("textbox", { name: "Code from the email" })
        .pressSequentially(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("link", { name: "Later" }).click();
      await page.waitForURL(`${BASE_URL}/`);

      if (size === "phone") {
        await page
          .getByRole("navigation", { name: "Main navigation" })
          .getByRole("link", { name: "You" })
          .click();
        await page
          .getByRole("navigation", { name: "You" })
          .getByRole("link", { name: "Agents", exact: true })
          .click();
      } else {
        const showSidebar = page.getByRole("button", { name: "Show sidebar" });
        if (await showSidebar.isVisible()) await showSidebar.click();
        await page.getByRole("link", { name: "Agents", exact: true }).click();
      }
      await page.waitForURL(`${BASE_URL}/agents**`);

      // One search field on the page; the catalog has none of its own.
      const search = page.getByRole("textbox", {
        name: "Search agents, coworkers, and offers",
      });
      await search.waitFor();
      assert.equal(
        await page.getByRole("main").getByRole("textbox").count(),
        1,
        "the page has one search field",
      );
      await search.fill("research");
      await page.getByRole("radio", { name: "Agents", exact: true }).click();
      await page.waitForURL(/show=agents/);
      await page
        .getByRole("heading", { name: /^Browse all agents · \d+$/ })
        .waitFor();
      // Screen readers hear the new count while focus stays in the field.
      await page
        .getByRole("status")
        .filter({ hasText: /\d+ agents? match|No agents match/ })
        .waitFor();
      assert.equal(
        await page.getByRole("heading", { name: /^Your AI coworkers/ }).count(),
        0,
        "Agents scope hides the coworkers group",
      );
      await search.scrollIntoViewIfNeeded();
      await shot("0-search");
      const card = page.locator('main a[href^="/agents/"]').first();
      await card.scrollIntoViewIfNeeded();
      await shot("1-gallery");
      await card.click();
      await page.waitForURL(/\/agents\/[^/?]+$/);

      // Gutter: measured from the main content area, not the window, so an
      // open sidebar cannot stand in for the page's own margin.
      const main = page.locator("main[data-app-main]");
      const title = page.getByRole("heading", { level: 1 });
      await title.waitFor();
      const mainBox = await main.boundingBox();
      const titleBox = await title.boundingBox();
      assert.ok(mainBox && titleBox, "the agent name shows");
      assert.ok(
        titleBox.x - mainBox.x >= GUTTER,
        `name starts ${titleBox.x - mainBox.x}px into main`,
      );
      // Wider screens put the icon beside the name; the back link is the
      // leftmost thing on the page there.
      const back = page.getByRole("link", { name: "Back to agents" });
      if (await back.isVisible()) {
        const backBox = await back.boundingBox();
        assert.ok(backBox);
        const left = backBox.x - mainBox.x;
        assert.ok(left >= GUTTER, `back link starts ${left}px into main`);
      }
      const share = page.getByRole("button", { name: "Share", exact: true });
      if (await share.isVisible()) {
        const shareBox = await share.boundingBox();
        assert.ok(shareBox);
        const right = mainBox.x + mainBox.width - (shareBox.x + shareBox.width);
        assert.ok(right >= GUTTER, `Share ends ${right}px before main's edge`);
      }

      // Find, on arrival and before any scroll. The profile used to lay the
      // field out under the header (phone: y=8 under a 64px top bar), so it
      // could never be reached. Its place in the page must start below the
      // header. Where the page is scrolled to on arrival is a separate,
      // app-wide behaviour (the router scrolls the new page's content into
      // view, so a shell toolbar above it can start just out of sight); this
      // spec does not assert it.
      const find = page.getByRole("searchbox", { name: "Find on this page" });
      await find.waitFor();
      const banner = await page.getByRole("banner").boundingBox();
      assert.ok(banner, "the header shows");
      const findTopAtRest = await find.evaluate((input) => {
        const scroller = document.querySelector("main[data-app-main]");
        return (
          input.getBoundingClientRect().top +
          (scroller?.scrollTop ?? 0) +
          window.scrollY
        );
      });
      assert.ok(
        findTopAtRest >= banner.y + banner.height,
        `Find sits at ${findTopAtRest}px, under the header (ends ${banner.y + banner.height}px)`,
      );

      // Scroll back up as a person would, then the field takes a tap.
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.mouse.wheel(0, -5000);
      await page.waitForFunction(
        () =>
          window.scrollY === 0 &&
          document.querySelector("main[data-app-main]")?.scrollTop === 0,
      );
      const findVisible = await find.evaluate((input) => {
        const r = input.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        return Boolean(hit && input.closest("div")?.contains(hit));
      });
      assert.ok(findVisible, "the Find field is not covered by the header");

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      assert.equal(overflow, false, "the page scrolls sideways");
      await shot("2-profile");

      // Start a task opens New task; cancel without creating anything.
      await page.getByRole("button", { name: "Start a task" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await shot("3-new-task");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
