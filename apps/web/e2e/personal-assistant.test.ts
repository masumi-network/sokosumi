import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user names their Soko Bot, first with only spaces, then for real, and
// opens its Advanced view: the empty and error states say what is missing,
// the Daily limit shows its whole number, and each schedule's controls carry
// the schedule's name.
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

/**
 * The step's heading shows once the page has hydrated. A field filled before
 * then loses its value, as the onboarding spec found.
 */
async function expectStep(page: Page, path: RegExp, heading: string) {
  await page.waitForURL(path);
  await page
    .getByRole("main")
    .getByRole("heading", { name: heading })
    .waitFor();
}

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
      await expectStep(page, /\/signup/, "Create your account");
      // The server-rendered heading shows before hydration, and an address
      // typed before then is dropped. The chip proves React took it.
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
      await page.getByRole("textbox", { name: "First name" }).fill("Mira");
      await page.getByRole("textbox", { name: "Last name" }).fill(name);
      await page
        .getByRole("textbox", { name: "Code from the email" })
        .pressSequentially(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();
      await expectStep(page, /\/setup$/, "How do you want to work?");
      await page.getByRole("button", { name: "Continue" }).click();

      // Spaces pass the browser's `required` check, so the step says why.
      await expectStep(page, /\/setup\/assistant$/, "Name your Soko Bot");
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
      // Wait for the bot's hello. Loaded before it lands, the next page's
      // server render and the sidebar's client data disagree on its unread
      // count, and React reports a hydration error (#418).
      await page.getByRole("main").getByText(`I'm ${BOT}`).waitFor();

      await page.goto(`${BASE_URL}/personal-assistant?view=advanced`);
      const main = page.getByRole("main");
      await main.getByRole("heading", { name: "Memory" }).waitFor();
      await main.getByText("No memory yet.").waitFor();
      assert.equal(await main.getByText("None", { exact: true }).count(), 0);
      await shot("2-empty-memory");

      // The text beside the Daily limit once squeezed it to one digit on a
      // phone ("2" for 20).
      const limit = main.getByRole("spinbutton", { name: "Daily limit" });
      await limit.scrollIntoViewIfNeeded();
      assert.equal(await limit.inputValue(), "20");
      assert.ok(
        await limit.evaluate((el) => el.scrollWidth <= el.clientWidth),
        "the Daily limit field cuts its number",
      );
      // Archive and Delete sit apart, not flush.
      const archive = await main
        .getByRole("button", { name: "Archive", exact: true })
        .boundingBox();
      const remove = await main
        .getByRole("button", { name: "Delete", exact: true })
        .boundingBox();
      assert.ok(archive && remove);
      // gap-2: 8px apart in one row, or 8px below when Delete wraps.
      const sameRow = Math.abs(remove.y - archive.y) < 1;
      assert.ok(
        sameRow
          ? remove.x - (archive.x + archive.width) >= 8
          : remove.y - (archive.y + archive.height) >= 8,
        "Archive and Delete touch",
      );
      await shot("3-settings");

      // Each schedule's controls carry its name, so a cut-off row is clear.
      await page.goto(`${BASE_URL}/personal-assistant`);
      const dreaming = main.getByRole("switch", {
        name: "Dreaming",
        exact: true,
      });
      await dreaming.waitFor();
      assert.equal(await dreaming.getAttribute("aria-checked"), "true");
      await shot("4-schedules");

      await context.close();
      assert.deepEqual(errors, []);
    });
  });
}
