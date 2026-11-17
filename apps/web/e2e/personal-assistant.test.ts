import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user names their Soko Bot, first with only spaces, then for real, and
// opens its Advanced view: the empty and error states say what is missing.
// Each size signs up a new throwaway user; nothing is paid for or connected.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];
const BOT = "Atlas";

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name, ...viewport } of PROJECTS) {
  describe(name, () => {
    test("a new bot's name and memory say what is missing", async () => {
      const mailbox = await createMailbox();
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}personal-assistant-${name}-${step}.png`,
        });

      await page.goto(`${BASE_URL}/`);
      await page.getByRole("link", { name: "Register" }).click();
      await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByRole("textbox", { name: "First name" }).fill("Mira");
      await page.getByRole("textbox", { name: "Last name" }).fill(name);
      await page
        .getByRole("textbox", { name: "Code from the email" })
        .pressSequentially(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();
      await page.waitForURL(/\/setup$/);
      await page.getByRole("button", { name: "Continue" }).click();

      // Spaces pass the browser's `required` check, so the step says why.
      await page.waitForURL(/\/setup\/assistant$/);
      const nameField = page.getByRole("textbox", { name: "Name" });
      await nameField.fill("   ");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByText("Enter a name.").waitFor();
      assert.equal(await nameField.getAttribute("aria-invalid"), "true");
      await shot("1-blank-name");

      await nameField.fill(BOT);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: `Create ${BOT}` }).click();
      await page.waitForURL(/\/setup\/assistant\/connect$/);
      await page.getByRole("link", { name: "Skip" }).click();
      await page.waitForURL(/\/chat\/rooms\//);

      await page.goto(`${BASE_URL}/personal-assistant?view=advanced`);
      const main = page.getByRole("main");
      await main.getByRole("heading", { name: "Memory" }).waitFor();
      await main.getByText("No memory yet.").waitFor();
      assert.equal(await main.getByText("None", { exact: true }).count(), 0);
      await shot("2-empty-memory");

      await context.close();
      assert.deepEqual(errors, []);
    });
  });
}
