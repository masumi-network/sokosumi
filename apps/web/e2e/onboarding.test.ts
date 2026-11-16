import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A first-time visitor with only the link: Register, the emailed code, a
// Personal workspace, a Soko Bot, then its chat. Each size signs up a new
// throwaway user; nothing is paid for or connected.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];
const BOT = "Juno";

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
});
after(() => browser.close());

/** The step's heading sits in the page's one main landmark. */
async function expectStep(page: Page, path: RegExp, heading: string) {
  await page.waitForURL(path);
  const main = page.getByRole("main");
  await main.getByRole("heading", { name: heading }).waitFor();
  assert.equal(await main.count(), 1, `${page.url()} has one main landmark`);
}

for (const { name, ...viewport } of PROJECTS) {
  describe(name, () => {
    test("a new visitor signs up and meets their Soko Bot", async () => {
      const mailbox = await createMailbox();
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}onboarding-${name}-${step}.png`,
        });

      await page.goto(`${BASE_URL}/`);
      await page.getByRole("link", { name: "Register" }).click();
      await expectStep(page, /\/signup/, "Create your account");
      await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();

      // The chip is named by the address it shows, then what it does.
      await page
        .getByRole("button", { name: `${mailbox.address} Change email` })
        .waitFor();
      await page.getByRole("textbox", { name: "First name" }).fill("Ada");
      await page.getByRole("textbox", { name: "Last name" }).fill(name);
      await page
        .getByRole("textbox", { name: "Code from the email" })
        .pressSequentially(await mailbox.nextCode());
      await shot("1-code");
      await page.getByRole("button", { name: "Register" }).click();

      await expectStep(page, /\/setup$/, "How do you want to work?");
      await shot("2-workspace");
      await page.getByRole("button", { name: "Continue" }).click();

      await expectStep(page, /\/setup\/assistant$/, "Name your Soko Bot");
      await page.getByRole("textbox", { name: "Name" }).fill(BOT);
      await page.getByRole("button", { name: "Continue" }).click();
      await page
        .getByRole("heading", { name: `Pick a picture for ${BOT}` })
        .waitFor();
      await shot("3-picture");
      await page.getByRole("button", { name: `Create ${BOT}` }).click();

      await expectStep(
        page,
        /\/setup\/assistant\/connect$/,
        `Give ${BOT} your inbox and calendar`,
      );
      await page.getByRole("link", { name: "Skip" }).click();

      await page.waitForURL(/\/chat\/rooms\//);
      await page.getByRole("textbox", { name: `Message ${BOT}` }).waitFor();
      await shot("4-chat");
      await context.close();
      assert.deepEqual(errors, []);
    });
  });
}
