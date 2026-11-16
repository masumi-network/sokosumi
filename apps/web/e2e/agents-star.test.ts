import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user stars an Agent, sees it in Starred, keeps it across a reload and
// unstars it. Each size signs up a new throwaway user; nothing is hired.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
});
after(() => browser.close());

/** Register with an emailed code and skip the Soko Bot for later. */
async function signUp(page: Page, lastName: string) {
  const mailbox = await createMailbox();
  await page.goto(`${BASE_URL}/`);
  await page.getByRole("link", { name: "Register" }).click();
  await page.waitForURL(/\/signup/);
  await page
    .getByRole("main")
    .getByRole("heading", { name: "Create your account" })
    .waitFor();
  await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page
    .getByRole("button", { name: `${mailbox.address} Change email` })
    .waitFor();
  await page.getByRole("textbox", { name: "First name" }).fill("Ada");
  await page.getByRole("textbox", { name: "Last name" }).fill(lastName);
  await page
    .getByRole("textbox", { name: "Code from the email" })
    .pressSequentially(await mailbox.nextCode());
  await page.getByRole("button", { name: "Register" }).click();
  await page.waitForURL(/\/setup$/);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/setup\/assistant$/);
  await page.getByRole("link", { name: "Later" }).click();
}

const starredHeading = (page: Page) =>
  page.getByRole("heading", { name: "Starred", exact: true });

for (const { name, ...viewport } of PROJECTS) {
  describe(name, () => {
    test("a new user stars an Agent, keeps it and unstars it", async () => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await signUp(page, name);
      // Phone reaches Agents through You; tablet opens the closed sidebar.
      if (viewport.width < 768) {
        await page
          .getByRole("navigation", { name: "Main navigation" })
          .getByRole("link", { name: /You$/ })
          .click();
        await page.waitForURL(/\/you$/);
      } else if (viewport.width < 1024) {
        await page.getByRole("button", { name: "Show sidebar" }).click();
      }
      await page.getByRole("link", { name: "Agents", exact: true }).click();
      await page.waitForURL(/\/agents$/);

      const firstStar = page.getByRole("button", { name: /^Star / }).first();
      const label = (await firstStar.getAttribute("aria-label")) ?? "";
      assert.equal(await starredHeading(page).count(), 0);

      await firstStar.click();
      await starredHeading(page).waitFor();
      const copies = page.getByRole("button", { name: label, exact: true });
      await page.waitForFunction(
        (l) =>
          [...document.querySelectorAll(`button[aria-label="${l}"]`)].every(
            (b) =>
              b.getAttribute("aria-pressed") === "true" &&
              !b.hasAttribute("aria-busy"),
          ),
        label,
      );
      await page.screenshot({ path: `${RESULTS_DIR}star-${name}-1.png` });

      await page.reload();
      await starredHeading(page).waitFor();
      assert.equal(await copies.first().getAttribute("aria-pressed"), "true");

      await copies.first().click();
      await starredHeading(page).waitFor({ state: "detached" });
      await page.screenshot({ path: `${RESULTS_DIR}star-${name}-2.png` });

      await context.close();
      assert.deepEqual(errors, []);
    });
  });
}
