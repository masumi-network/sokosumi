import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl, resolvePreviewCoreUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user creates an API key: it says "No recorded use". One read through
// Core with that key, and the list says "Used just now"; Delete then warns
// that the key is still in use. Reads only: the key lists the user's own
// Tasks. The key stays in memory, is never logged, and no screenshot is taken
// while it shows.
const BASE_URL = resolveBaseUrl(process.env);
// Anywhere but a PR preview the spec skips with the reason.
const CORE = (() => {
  try {
    return { url: resolvePreviewCoreUrl(BASE_URL), skip: false as const };
  } catch (error) {
    return { url: "", skip: (error as Error).message };
  }
})();
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const KEY_NAME = "E2E recipe sync";

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
after(() => browser?.close());

async function createApiKey(page: Page) {
  await page.getByRole("button", { name: "Create" }).click();
  const dialog = page.getByRole("dialog", { name: "Create new API key" });
  await dialog.getByRole("textbox", { name: "Name" }).fill(KEY_NAME);
  await dialog.getByRole("button", { name: "Create API key" }).click();
  const created = page.getByRole("dialog", { name: "New API key created" });
  // The key is the dialog's one button that is neither Done nor Close.
  const key = await created
    .getByRole("button")
    .filter({ hasNotText: /^(Done|Close)$/ })
    .first()
    .innerText();
  await created.getByRole("button", { name: "Done" }).click();
  return key.trim();
}

for (const { name: size, ...viewport } of PROJECTS) {
  describe(size, () => {
    test("a key shows its last use, and Delete warns while it is in use", {
      skip: CORE.skip,
    }, async () => {
      const mailbox = await createMailbox();
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}api-key-last-used-${size}-${step}.png`,
        });

      await page.goto(`${BASE_URL}/signup`);
      await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByRole("textbox", { name: "First name" }).fill("E2E");
      await page.getByRole("textbox", { name: "Last name" }).fill("Keys");
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
        await page.getByRole("link", { name: "Developer" }).click();
        await page
          .getByRole("navigation", { name: "Developer" })
          .getByRole("link", { name: "API keys" })
          .click();
      } else {
        await page.goto(`${BASE_URL}/developer/api-keys`);
      }

      const key = await createApiKey(page);
      // A fresh key has no recorded use.
      await page
        .getByText("No recorded use", { exact: true })
        .filter({ visible: true })
        .waitFor();
      await shot("1-new-key");

      // Native fetch, not page.request: Playwright's DEBUG=pw:api prints
      // request headers. No redirects, so the key goes only to the paired
      // Core; failures report status only.
      const read = await fetch(`${CORE.url}/v1/tasks?limit=1`, {
        redirect: "manual",
        headers: { authorization: `Bearer ${key}` },
      });
      assert.equal(read.status, 200, "reading Tasks with the key failed");

      await page.reload();
      const used = page
        .getByText(size === "phone" ? "Used just now" : "just now", {
          exact: true,
        })
        .filter({ visible: true });
      await used.waitFor();
      await shot("2-used");

      await page
        .getByRole("button", { name: "Delete API key" })
        .filter({ visible: true })
        .click();
      const dialog = page.getByRole("alertdialog", {
        name: "Delete API key",
      });
      await dialog
        .getByText(
          "This key was used just now. Anything still using it will stop working.",
        )
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        ),
        false,
        "the page scrolls sideways",
      );
      await shot("3-delete-warning");

      assert.deepEqual(errors, [], "page errors");
      await context.close();
    });
  });
}
