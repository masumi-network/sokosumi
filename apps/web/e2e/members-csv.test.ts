import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import {
  type Browser,
  type BrowserContextOptions,
  chromium,
  type Page,
} from "playwright";

import { resolveBaseUrl } from "./base-url.ts";

// A new user signs up, creates an organization and downloads its member list.
// Needs a disposable inbox: E2E_SIGNUP_EMAIL, and E2E_SIGNUP_CODE_COMMAND, a
// shell command that prints the 6-digit code mailed to it. Skipped without both.
const EMAIL = process.env.E2E_SIGNUP_EMAIL?.trim();
const CODE_COMMAND = process.env.E2E_SIGNUP_CODE_COMMAND?.trim();
const SKIP = !EMAIL || !CODE_COMMAND;
const BASE_URL = SKIP ? "" : resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const ORGANIZATION = "E2E Members";

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true, hasTouch: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true, hasTouch: true },
  {
    name: "desktop",
    width: 1440,
    height: 900,
    isMobile: false,
    hasTouch: false,
  },
];

let browser: Browser;
let storageState: BrowserContextOptions["storageState"];

/** Sign up through the real forms, then create an organization. */
async function signUp(page: Page) {
  await page.goto(BASE_URL);
  // The form only works once hydrated: a click before that is lost.
  await page.locator('[data-testid="auth-field-email"]').waitFor();
  await page.waitForLoadState("load");
  await page.getByRole("link", { name: "Register" }).click();
  await page.waitForURL(/\/signup/);
  await page.getByRole("heading", { name: "Create your account" }).waitFor();
  await page.waitForLoadState("load");
  await page.getByRole("textbox", { name: "Email" }).fill(EMAIL ?? "");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByRole("textbox", { name: "First name" }).fill("E2E");
  await page.getByRole("textbox", { name: "Last name" }).fill("Owner");
  const code = execSync(CODE_COMMAND ?? "", { encoding: "utf8" }).trim();
  await page.getByRole("textbox", { name: "Code from the email" }).fill(code);
  await page.getByRole("button", { name: "Register" }).click();

  await page.getByRole("radio", { name: /Organization/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(ORGANIZATION);
  await page
    .getByRole("textbox", { name: "Website" })
    .fill("https://example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.getByRole("button", { name: "Go to workspace" }).click();
  await page.getByRole("link", { name: "Later" }).click();
  await page.waitForURL(`${BASE_URL}/`);
}

before(async () => {
  if (SKIP) return;
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUp(page);
  storageState = await context.storageState();
  await context.close();
});
after(() => browser?.close());

describe("members CSV", {
  skip: SKIP && "set E2E_SIGNUP_EMAIL and E2E_SIGNUP_CODE_COMMAND",
}, () => {
  for (const { name, ...viewport } of PROJECTS) {
    test(`${name}: an owner downloads the member list from Settings`, async () => {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
        storageState,
        acceptDownloads: true,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await page.goto(BASE_URL);
      const showSidebar = page.getByRole("button", { name: "Show sidebar" });
      if (await showSidebar.isVisible()) await showSidebar.click();
      await page
        .getByRole("button", { name: ORGANIZATION })
        .filter({ visible: true })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Settings" }).click();

      const button = page.getByRole("button", { name: "Download CSV" });
      await button.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${RESULTS_DIR}${name}-members-csv.png` });
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        button.click(),
      ]);
      const csv = readFileSync(await download.path(), "utf8")
        .replace(/^﻿/, "")
        .split("\r\n");
      await context.close();

      assert.match(
        download.suggestedFilename(),
        /^members-.+-\d{4}-\d{2}-\d{2}\.csv$/,
      );
      assert.equal(
        csv[0],
        '"Name","Email","Role","Status","Joined","Last seen","Invited","Invitation expires"',
      );
      assert.equal(csv.length, 2);
      assert.match(
        csv[1],
        new RegExp(`^"E2E Owner","${EMAIL}","Owner","Active",`),
      );
      assert.equal(overflow, 0, `organization page overflows by ${overflow}px`);
      assert.deepEqual(errors, []);
    });
  }
});
