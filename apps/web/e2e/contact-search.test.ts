import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Locator, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user finds a Contact from search: add a contact with a company, go
// to Tasks, open search, type part of the company, and pick the person from
// the People group; the Contact's panel opens in Contacts. Each size signs
// up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const NAME = "Mira Testperson";
const COMPANY = "Quokka Labs";

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}contact-search-${size}-${step}.png`,
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
    await page.getByTestId("header-mobile-search-trigger").tap();
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
    test("a new user finds a contact in search and opens it", async () => {
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

      await page.goto(`${BASE_URL}/contacts`);
      await page.getByRole("button", { name: "Add someone" }).waitFor();
      await page
        .getByRole("button", { name: "Add contact" })
        .filter({ visible: true })
        .click();
      const add = page.getByRole("dialog", { name: "Add contact" });
      await add.getByLabel("Name").fill(NAME);
      await add.getByLabel("Organization").fill(COMPANY);
      await add.getByRole("button", { name: "Add contact" }).click();
      await page.getByRole("dialog", { name: NAME }).waitFor();

      // Search from another page, by part of the company name.
      await page.goto(`${BASE_URL}/tasks`);
      await page.getByRole("heading", { name: "Backlog" }).waitFor();
      const search = await openSearch(page, size, "quokka");
      const people = search.getByRole("group", { name: "People" });
      const person = people.getByRole("option", { name: new RegExp(NAME) });
      await person.waitFor();
      await people.getByText(COMPANY).waitFor();
      assert.equal(
        await search.getByText("No results found").count(),
        0,
        "search says No results found next to a matching contact",
      );
      await noSidewaysScroll(page);
      await shot(page, size, "1-search");

      await press(person, size);
      await page.waitForURL(/\/contacts\?contact=/);
      await page.getByRole("dialog", { name: NAME }).waitFor();
      await noSidewaysScroll(page);
      await shot(page, size, "2-panel");

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
