import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Locator, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

// A new user finds a Schedule and a Coworker from search: sign up with an
// Organization, create an unassigned Schedule (its runs make unassigned Tasks,
// so nothing spends credits), go to Tasks, open search and type part of its
// name. The Schedules group opens the Schedule. Then search a Coworker: its
// row opens New task with that Coworker already chosen; the draft is not
// sent. Each size signs up its own disposable mail.tm inbox. Free only.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const SCHEDULE = "Weekly competitor report";

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}search-schedules-coworkers-${size}-${step}.png`,
  });
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
}

async function openSearch(page: Page, size: string, query: string) {
  if (size === "phone") {
    // A page change can briefly hold two headers; tap the one on screen.
    await page
      .getByTestId("header-mobile-search-trigger")
      .filter({ visible: true })
      .first()
      .tap();
  } else {
    const showSidebar = page.getByRole("button", { name: "Show sidebar" });
    if (await showSidebar.isVisible()) await showSidebar.click();
    await page.getByRole("button", { name: "Search", exact: true }).click();
  }
  const dialog = page.getByRole("dialog", { name: "Search" });
  const input = dialog.getByRole("combobox");
  await input.waitFor();
  if (size === "phone") await page.keyboard.type(query);
  else await input.fill(query);
  return dialog;
}

async function press(locator: Locator, size: string) {
  if (size === "phone") await locator.tap();
  else await locator.click();
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
    test("a new user opens a Schedule and starts a Task with a Coworker from search", async () => {
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

      await page.goto(`${BASE_URL}/schedules`);
      await page
        .getByRole("button", { name: "New schedule" })
        .filter({ visible: true })
        .first()
        .click();
      const form = page.getByRole("dialog", { name: "New schedule" });
      await form.getByRole("textbox", { name: "Name" }).fill(SCHEDULE);
      await form.getByRole("button", { name: "Create schedule" }).click();
      await page.getByText("Schedule created").waitFor();

      // Search from another page, by one word of the name.
      await page.goto(`${BASE_URL}/tasks`);
      await page.getByRole("heading", { name: "Backlog" }).waitFor();
      const search = await openSearch(page, size, "competitor");
      const schedule = search
        .getByRole("group", { name: "Schedules" })
        .getByRole("option", { name: SCHEDULE });
      await schedule.waitFor();
      assert.equal(
        await search.getByText("No results found").count(),
        0,
        "search says No results found next to a match",
      );
      await noSidewaysScroll(page);
      await shot(page, size, "1-schedule-result");

      await press(schedule, size);
      await page.waitForURL(/\/schedules\/[^/?]+$/);
      await page.getByRole("heading", { level: 1, name: SCHEDULE }).waitFor();
      await shot(page, size, "2-schedule");

      const again = await openSearch(page, size, "seo");
      const coworker = again
        .getByRole("group", { name: "Coworkers" })
        .getByRole("option", { name: / New task$/ })
        .first();
      await coworker.waitFor();
      // The row reads "<Coworker> New task", its visible text.
      const name = (await coworker.textContent())
        ?.replace(/New task$/, "")
        .trim();
      assert.ok(name, "the Coworker row names its Coworker");
      await noSidewaysScroll(page);
      await shot(page, size, "3-coworker-result");

      await press(coworker, size);
      const draft = page.getByRole("dialog", { name: "New task" });
      await draft
        .getByRole("heading", { name: `What should ${name} do?` })
        .waitFor();
      await noSidewaysScroll(page);
      await shot(page, size, "4-new-task");

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
