import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A first-time visitor with only the link: Register, the emailed code, a
// Personal workspace or an Organization, a Soko Bot, then its chat. Each test signs up a new
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
      const register = page.getByRole("link", { name: "Register" });
      // WCAG 2.5.8: the first tap a new visitor makes is at least 24px tall.
      const registerBox = await register.boundingBox();
      assert.ok(
        registerBox && registerBox.height >= 24,
        "Register is 24px tall",
      );
      await register.click();
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
      // The address in "We sent a 6-digit code to …" sits in a box of its own,
      // so it moves to the next line whole instead of breaking at a hyphen.
      await page
        .locator("p span.inline-block", { hasText: mailbox.address })
        .waitFor();
      await shot("1-code");
      await page.getByRole("button", { name: "Register" }).click();

      await expectStep(page, /\/setup$/, "How do you want to work?");
      await expectLegalLinks(page);
      // The logo stays put from sign-up to setup.
      assert.deepEqual(await logoBox(page), signupLogo);
      await shot("2-workspace");
      await page.getByRole("button", { name: "Continue" }).click();

      await expectStep(page, /\/setup\/assistant$/, "Name your Soko Bot");
      // An empty name gets the page's own error, not the browser's bubble.
      await page.getByRole("button", { name: "Continue" }).click();
      await page
        .getByRole("alert")
        .filter({ hasText: "Enter a name." })
        .waitFor();
      await page.getByRole("textbox", { name: "Name" }).fill(BOT);
      await page.getByRole("button", { name: "Continue" }).click();
      await page
        .getByRole("heading", { name: `Choose a look for ${BOT}` })
        .waitFor();
      // Create is pinned to the foot at every size, so it is on screen before
      // any scroll, with the options still to pick above it.
      const create = page.getByRole("button", { name: `Create ${BOT}` });
      await create.and(page.locator(":enabled")).waitFor();
      const createBox = await create.boundingBox();
      assert.ok(
        createBox &&
          createBox.y >= 0 &&
          createBox.y + createBox.height <= viewport.height,
        "Create is on screen when Create can be pressed",
      );

      // Every animal is a real target at every size; viewport breakpoints once
      // drew them 8px wide in setup's narrow frame. DESIGN.md touch targets:
      // 40px below md (768), 32px from md up.
      const minTarget = viewport.width < 768 ? 40 : 32;
      const owl = page.getByRole("button", { name: "Owl", exact: true });
      const owlBox = await owl.boundingBox();
      assert.ok(
        owlBox && owlBox.width >= minTarget && owlBox.height >= minTarget,
        `the Owl tile is at least ${minTarget}px square`,
      );
      await owl.click();
      assert.equal(await owl.getAttribute("aria-pressed"), "true");
      await shot("3-picture");

      // The rest of the look folds under More details. Open, every control
      // stays inside the studio's frame, a pick survives a fold, and the last
      // option clears the pinned Create.
      const more = page.getByRole("button", { name: /More details/ });
      await more.click();
      // The studio's own box; the frame around it has padding that hides overflow.
      const studio = owl.locator(
        "xpath=ancestor::div[contains(@class,'@container')]",
      );
      const frame = await studio.boundingBox();
      const sticking = await studio
        .locator("button, [role=radio]")
        .evaluateAll(
          (els, right) =>
            els.filter((el) => el.getBoundingClientRect().right > right + 0.5)
              .length,
          (frame?.x ?? 0) + (frame?.width ?? 0),
        );
      assert.equal(sticking, 0, "no studio control sticks out of its frame");
      const headwear = page.getByRole("radiogroup", { name: "Headwear" });
      await headwear.getByRole("radio", { name: "Crown" }).click();
      await more.click();
      await more.click();
      assert.equal(
        await headwear
          .getByRole("radio", { name: "Crown" })
          .getAttribute("aria-checked"),
        "true",
        "a pick survives folding More details",
      );
      const star = headwear.getByRole("radio", { name: "Star" });
      await star.focus();
      const starBox = await star.boundingBox();
      const pinned = await create.boundingBox();
      assert.ok(
        starBox &&
          pinned &&
          starBox.y + starBox.height <= pinned.y &&
          pinned.y + pinned.height <= viewport.height,
        "the last option clears Create, which stays on screen",
      );
      await create.click();

      await expectStep(
        page,
        /\/setup\/assistant\/connect$/,
        `Give ${BOT} your inbox and calendar`,
      );
      await page.getByRole("link", { name: "Skip" }).click();

      await page.waitForURL(/\/chat\/rooms\//);
      const message = page.getByRole("textbox", { name: `Message ${BOT}` });
      await message.fill("What should I set up first?");
      await page.getByRole("button", { name: "Send message" }).click();
      await page
        .getByRole("main")
        .getByText("What should I set up first?")
        .waitFor();
      await shot("4-chat");
      // Home lists that first question as the reader's own, sent to the bot.
      await page.goto(`${BASE_URL}/`);
      await page
        .getByRole("link", {
          name: new RegExp(`What should I set up first\\?.*You to ${BOT}`),
        })
        .waitFor();
      await shot("5-home");
      await context.close();
      assert.deepEqual(errors, []);
    });

    test("a new visitor sets up an Organization and meets their Soko Bot", async () => {
      const mailbox = await createMailbox();
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await page.goto(`${BASE_URL}/`);
      await page.getByRole("link", { name: "Register" }).click();
      await expectStep(page, /\/signup/, "Create your account");
      await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByRole("textbox", { name: "First name" }).fill("Ada");
      await page.getByRole("textbox", { name: "Last name" }).fill(name);
      await page
        .getByRole("textbox", { name: "Code from the email" })
        .pressSequentially(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();

      await expectStep(page, /\/setup$/, "How do you want to work?");
      await page.getByRole("radio", { name: /Organization/ }).click();
      await page.getByRole("button", { name: "Continue" }).click();

      // An empty Continue names both missing fields at once, and each field
      // is described by its own error, not the other's.
      const dialog = page.getByRole("dialog", { name: "Create organization" });
      const orgName = dialog.getByRole("textbox", { name: "Name" });
      const website = dialog.getByRole("textbox", { name: "Website" });
      await dialog.getByRole("button", { name: "Continue" }).click();
      const nameError = "Enter a name with at least 2 characters.";
      const urlError = "Enter a valid website, like https://acme.com";
      await dialog.getByRole("alert").filter({ hasText: urlError }).waitFor();
      assert.deepEqual(await dialog.getByRole("alert").allTextContents(), [
        nameError,
        urlError,
      ]);
      assert.equal(
        await orgName.evaluate((el) => el.getAttribute("aria-describedby")),
        await dialog
          .getByRole("alert")
          .filter({ hasText: nameError })
          .getAttribute("id"),
      );
      assert.equal(
        await website.evaluate((el) => el.getAttribute("aria-describedby")),
        await dialog
          .getByRole("alert")
          .filter({ hasText: urlError })
          .getAttribute("id"),
      );
      await page.screenshot({
        path: `${RESULTS_DIR}onboarding-${name}-org-errors.png`,
      });

      await orgName.fill("Ada Test Studio");
      await website.fill("example.com");
      await dialog.getByRole("button", { name: "Continue" }).click();
      // The logo step reads "Skip for now", or "Continue" once the site's icon
      // resolves first. Wait for the step so the name step's Continue is gone.
      await dialog.getByRole("heading", { name: "Your logo" }).waitFor();
      await dialog
        .getByRole("button", { name: /^(Skip for now|Continue)$/ })
        .click();
      await dialog.getByRole("button", { name: "Finish setup" }).click();
      await dialog.getByRole("button", { name: "Go to workspace" }).click();

      await expectStep(page, /\/setup\/assistant$/, "Name your Soko Bot");
      await page.getByRole("textbox", { name: "Name" }).fill(BOT);
      await page.getByRole("button", { name: "Continue" }).click();
      const create = page.getByRole("button", { name: `Create ${BOT}` });
      await create.and(page.locator(":enabled")).click();
      await expectStep(
        page,
        /\/setup\/assistant\/connect$/,
        `Give ${BOT} your inbox and calendar`,
      );
      await page.getByRole("link", { name: "Skip" }).click();
      await page.waitForURL(/\/chat\/rooms\//);
      await page.getByRole("textbox", { name: `Message ${BOT}` }).waitFor();
      await context.close();
      assert.deepEqual(errors, []);
    });
  });
}
