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

/** Setup lists the same policies as sign-up, each a 24px-tall target. */
async function expectLegalLinks(page: Page) {
  for (const policy of [
    "Terms of Service",
    "Privacy Policy",
    "Imprint",
    "Acceptable Use",
  ]) {
    const box = await page
      .getByRole("link", { name: policy, exact: true })
      .last()
      .boundingBox();
    assert.ok(box && box.height >= 24, `${policy} is at least 24px tall`);
  }
}

/** The header logo's place and size, to hold setup's against sign-up's. */
async function logoBox(page: Page) {
  const box = await page
    .getByRole("img", { name: "Sokosumi Logo", exact: true })
    .filter({ visible: true })
    .first()
    .boundingBox();
  assert.ok(box, `${page.url()} shows the logo`);
  return box;
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
      const signupLogo = await logoBox(page);
      await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();

      // The chip is named by the address it shows, then what it does.
      await page
        .getByRole("button", { name: `${mailbox.address} Change email` })
        .waitFor();
      await page.getByRole("textbox", { name: "First name" }).fill("Ada");
      await page.getByRole("textbox", { name: "Last name" }).fill(name);
      const codeField = page.getByRole("textbox", {
        name: "Code from the email",
      });
      // A paste with no clipboard, as Lighthouse and some autofill tools
      // send, must not throw.
      await codeField.dispatchEvent("paste");
      await codeField.pressSequentially(await mailbox.nextCode());
      await shot("1-code");
      await page.getByRole("button", { name: "Register" }).click();

      await expectStep(page, /\/setup$/, "How do you want to work?");
      await expectLegalLinks(page);
      // The logo stays put from sign-up to setup.
      assert.deepEqual(await logoBox(page), signupLogo);
      await shot("2-workspace");
      await page.getByRole("button", { name: "Continue" }).click();

      await expectStep(page, /\/setup\/assistant$/, "Name your Soko Bot");
      await page.getByRole("textbox", { name: "Name" }).fill(BOT);
      await page.getByRole("button", { name: "Continue" }).click();
      await page
        .getByRole("heading", { name: `Choose a look for ${BOT}` })
        .waitFor();
      // Every animal is a real target at every size; viewport breakpoints once
      // drew them 8px wide in setup's narrow frame.
      const owl = page.getByRole("button", { name: "Owl", exact: true });
      const owlBox = await owl.boundingBox();
      assert.ok(owlBox && owlBox.width >= 32, "the Owl tile is at least 32px");
      await owl.click();
      assert.equal(await owl.getAttribute("aria-pressed"), "true");
      // A look is free; the credit notice sits under Create, which makes the bot.
      const notice = page.getByText("Uses your credits.");
      const create = page.getByRole("button", { name: `Create ${BOT}` });
      assert.ok(
        ((await notice.boundingBox())?.y ?? 0) >
          ((await create.boundingBox())?.y ?? Infinity),
        "the credit notice follows Create",
      );
      await shot("3-picture");
      await create.click();

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
