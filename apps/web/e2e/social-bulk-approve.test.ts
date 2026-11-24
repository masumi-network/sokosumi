import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user asks their Soko Bot for two X posts without an account, then
// approves both from Social's Drafts in one step. With no time and no account
// each approved post becomes a draft, so nothing can be published.
// Each size signs up a new throwaway user; nothing is paid for or connected.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];
const BOT = "Pip";
const PROJECT = "E2E Bakery";

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
});
after(() => browser.close());

/** The step's heading shows once the page has hydrated. */
async function expectStep(page: Page, path: RegExp, heading: string) {
  await page.waitForURL(path);
  await page
    .getByRole("main")
    .getByRole("heading", { name: heading })
    .waitFor();
}

for (const { name, ...viewport } of PROJECTS) {
  describe(name, () => {
    test("a new user approves two waiting posts at once", async () => {
      const mailbox = await createMailbox();
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}social-bulk-approve-${name}-${step}.png`,
        });

      await page.goto(`${BASE_URL}/`);
      await page.getByRole("link", { name: "Register" }).click();
      await expectStep(page, /\/signup/, "Create your account");
      const chip = page.getByRole("button", {
        name: `${mailbox.address} Change email`,
      });
      for (let attempt = 0; !(await chip.isVisible()); attempt++) {
        assert.ok(attempt < 3, "the email step never took the address");
        await page
          .getByRole("textbox", { name: "Email" })
          .fill(mailbox.address);
        await page.getByRole("button", { name: "Continue with email" }).click();
        await chip.waitFor({ timeout: 10_000 }).catch(() => {});
      }
      await page.getByRole("textbox", { name: "First name" }).fill("Ada");
      await page.getByRole("textbox", { name: "Last name" }).fill(name);
      await page
        .getByRole("textbox", { name: "Code from the email" })
        .pressSequentially(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();
      await expectStep(page, /\/setup$/, "How do you want to work?");
      await page.getByRole("button", { name: "Continue" }).click();
      await expectStep(page, /\/setup\/assistant$/, "Name your Soko Bot");
      await page.getByRole("textbox", { name: "Name" }).fill(BOT);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: `Create ${BOT}` }).click();
      await page.waitForURL(/\/setup\/assistant\/connect$/);
      await page.getByRole("link", { name: "Skip" }).click();
      await page.waitForURL(/\/chat\/rooms\//);
      const main = page.getByRole("main");
      await main.getByText(`I'm ${BOT}`).waitFor();

      // The bot drafts; every post it saves waits for a person's approval.
      await main
        .getByRole("textbox", { name: `Message ${BOT}` })
        .fill(
          `Create a project called "${PROJECT}" and save these two posts in it as standard X posts without an account, with no date or time, waiting for my approval: "Fresh sourdough today." and "Warm rolls at noon."`,
        );
      await page.keyboard.press("Enter");
      await main
        .getByText("Needs approval")
        .nth(1)
        .waitFor({ timeout: 240_000 });

      await page.goto(`${BASE_URL}/social?tab=drafts`);
      await main.getByRole("button", { name: "Select project" }).click();
      await page
        .getByRole("combobox", { name: "Find a project..." })
        .fill("E2E");
      await page.keyboard.press("Enter");
      const approveSelected = main.getByRole("button", {
        name: "Approve selected",
      });
      await approveSelected.waitFor();
      assert.equal(await approveSelected.isDisabled(), true);
      await shot("1-waiting");

      const boxes = main.getByRole("checkbox", {
        name: "Select this post to approve",
      });
      assert.equal(await boxes.count(), 2);
      for (const box of await boxes.all()) {
        const size = await box.boundingBox();
        assert.ok(size && size.width >= 16 && size.height >= 16);
        if (name !== "desktop") {
          assert.ok(size.width >= 24, "the checkbox is under 24px on touch");
        }
        await box.click();
      }
      await main.getByText("2 selected").waitFor();
      await approveSelected.click();

      const dialog = page.getByRole("alertdialog");
      await dialog.getByRole("heading", { name: "Approve 2 posts?" }).waitFor();
      assert.equal(await dialog.getByText("Becomes a draft").count(), 2);
      assert.ok(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
        "the confirmation is wider than the screen",
      );
      await shot("2-confirm");
      await dialog.getByRole("button", { name: "Approve selected" }).click();

      await dialog.getByRole("heading", { name: "Approval results" }).waitFor();
      assert.equal(await dialog.getByText("Approved as a draft").count(), 2);
      await shot("3-results");
      await dialog.getByRole("button", { name: "Close" }).click();

      // Both are drafts now, so nothing is left to approve.
      await main
        .getByText("Needs approval")
        .first()
        .waitFor({ state: "detached" });
      await shot("4-after");

      await context.close();
      assert.deepEqual(errors, []);
    });
  });
}
