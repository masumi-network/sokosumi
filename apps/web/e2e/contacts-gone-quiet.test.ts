import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl, resolvePreviewCoreUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user's Gone quiet list, end to end: add two contacts, give one an
// interaction 90 days old and the other one 5 days old, open "1 gone quiet"
// beside the count, plan a follow-up next week from the row, Undo it, plan it
// again, and find it in the Calendar's agenda. No screen logs a past
// interaction, so the spec creates an API key in Developer settings and logs
// both through Core's public `/v1/contacts/{id}/interactions`.
const BASE_URL = resolveBaseUrl(process.env);
// Anywhere but a PR preview the spec skips with the reason: only a PR
// preview pairs with a Core that takes test data.
const CORE = (() => {
  try {
    return { url: resolvePreviewCoreUrl(BASE_URL), skip: false as const };
  } catch (error) {
    return { url: "", skip: (error as Error).message };
  }
})();
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const QUIET = "Mira Quietperson";
const RECENT = "Lena Recentperson";

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}gone-quiet-${size}-${step}.png`,
  });
}

async function addContact(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Add contact" })
    .filter({ visible: true })
    .click();
  const add = page.getByRole("dialog", { name: "Add contact" });
  await add.getByLabel("Name").fill(name);
  await add.getByRole("button", { name: "Add contact" }).click();
  await page.getByRole("dialog", { name }).waitFor();
  const id = new URL(page.url()).searchParams.get("contact");
  await page.keyboard.press("Escape");
  assert.ok(id, `no contact id for ${name}`);
  return id;
}

let browser: Browser | undefined;
before(async () => {
  if (CORE.skip) return;
  mkdirSync(RESULTS_DIR, { recursive: true });
  console.log(`E2E_BASE_URL=${BASE_URL}`);
  browser = await chromium.launch();
});
after(() => browser?.close());

for (const { name: size, isMobile, ...viewport } of PROJECTS) {
  describe(size, () => {
    test("a new user plans a follow-up with someone who went quiet", {
      skip: CORE.skip,
    }, async () => {
      if (!browser) throw new Error("no browser");
      // Desktop setup, so Developer settings and the grid are one click away;
      // the feature itself runs at this size below.
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
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
      const quietId = await addContact(page, QUIET);
      const recentId = await addContact(page, RECENT);

      await page.goto(`${BASE_URL}/developer/api-keys`);
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Create" }).click();
      await page
        .getByRole("dialog", { name: "Create new API key" })
        .getByRole("textbox", { name: "Name" })
        .fill("e2e gone quiet");
      await page.getByRole("button", { name: "Create API key" }).click();
      const created = page.getByRole("dialog", { name: "New API key created" });
      // The key is the dialog's one button that is neither Done nor Close.
      const key = (
        await created
          .getByRole("button")
          .filter({ hasNotText: /^(Done|Close)$/ })
          .first()
          .innerText()
      ).trim();
      assert.ok(key, "no API key shown");
      await created.getByRole("button", { name: "Done" }).click();
      for (const [id, days] of [
        [quietId, 90],
        [recentId, 5],
      ] as const) {
        const response = await fetch(
          `${CORE.url}/v1/contacts/${id}/interactions`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${key}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              occurredAt: new Date(
                Date.now() - days * 86_400_000,
              ).toISOString(),
              channel: "EMAIL",
              direction: "BOTH",
              summary: "E2E test interaction",
            }),
          },
        );
        assert.equal(response.status, 201, await response.text());
      }

      await page.setViewportSize(viewport);
      await page.goto(`${BASE_URL}/contacts`);
      assert.equal(
        await page.getByRole("radio", { name: /Gone quiet/ }).count(),
        0,
        "Gone quiet is a tab",
      );
      await page.getByRole("button", { name: "1 gone quiet" }).click();
      const heading = page.getByRole("heading", { name: "Gone quiet" });
      await heading.waitFor();
      assert.equal(
        await heading.evaluate((element) => element === document.activeElement),
        true,
        "focus did not land on the Gone quiet heading",
      );
      await page.getByText(/Last talked 3 months ago/).waitFor();
      assert.equal(
        await page.getByText(RECENT).count(),
        0,
        "a recent contact went quiet",
      );
      await shot(page, size, "1-quiet");

      // Its name is its visible words (short on phones), then who.
      const followUp = page.getByRole("button", {
        name: new RegExp(`^(Follow up next week|Next week) for ${QUIET}$`),
      });
      await followUp.click();
      await page.getByText(/^Follow-up /).waitFor();
      await page.getByRole("button", { name: "Undo" }).click();
      await followUp.waitFor();
      // Calendar reads from Core: open it only once Core has this save. The
      // first save's toast can still show the same words, so wait for the
      // save itself.
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes("/v1/contacts/") &&
          response.ok(),
      );
      await followUp.click();
      await saved;
      await page.getByText(/^Follow-up /).waitFor();
      await shot(page, size, "2-planned");

      await page.goto(`${BASE_URL}/calendar`);
      // The Calendar writes the reader's time zone into the URL once loaded;
      // a click before that is lost.
      await page.waitForURL(/timezone=/);
      // Agenda lists what is coming up at every size (phones open on it).
      await page.getByRole("radio", { name: "Agenda" }).check();
      await page.getByRole("link", { name: `${QUIET}, Follow-ups` }).waitFor();
      await shot(page, size, "3-calendar");

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      await context.close();
      assert.equal(overflow, 0, `page overflows by ${overflow}px`);
      assert.deepEqual(errors, []);
    });
  });
}
