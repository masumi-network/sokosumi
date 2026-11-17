import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Locator, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox, type Mailbox } from "./mailbox.ts";

// A founder shares one data room answer with everyone in the room. A new user
// makes a data room in Files and lets in two of the run's own inboxes. The
// first asks about a document, the owner answers privately, then shares it:
// the second sees it on the Welcome page until the owner unshares it.
// Nothing is paid for; mail only goes to the run's throwaway inboxes.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];
const DESKTOP = { width: 1440, height: 900 };
const FOLDER = "Seed round";
const DOCUMENT = "Key metrics.pdf";
const QUESTION = "How is net revenue retention calculated here?";
const ANSWER = "Revenue from last year's customers over their revenue then.";

// The smallest PDF the room's viewer opens: one blank page.
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n",
);

/**
 * Fills `field` until `submit` turns on: a fill that lands before the page
 * hydrates is lost, and the button stays off.
 */
async function fillUntilEnabled(
  field: Locator,
  value: string,
  submit: Locator,
) {
  for (let i = 0; i < 5 && !(await submit.isEnabled()); i++) {
    await field.fill(value);
    await field.page().waitForTimeout(500);
  }
}

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
});
after(() => browser.close());

async function signUp(page: Page, mailbox: Mailbox) {
  await page.goto(`${BASE_URL}/`);
  await page.getByRole("link", { name: "Register" }).click();
  // Sign-in has an Email field too: fill only once sign-up has replaced it.
  await page.waitForURL(/\/signup/);
  await page.getByRole("heading", { name: "Create your account" }).waitFor();
  await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByRole("textbox", { name: "First name" }).fill("Ada");
  await page.getByRole("textbox", { name: "Last name" }).fill("Founder");
  await page
    .getByRole("textbox", { name: "Code from the email" })
    .pressSequentially(await mailbox.nextCode());
  await page.getByRole("button", { name: "Register" }).click();
  await page.waitForURL(/\/setup$/);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/setup\/assistant$/);
  await page.getByRole("link", { name: "Later" }).click();
  await page.waitForURL(`${BASE_URL}/`);
}

/** Files > Workspace > new folder with one PDF > data room with two people. */
async function makeRoom(page: Page, viewers: string[]) {
  await page.getByRole("link", { name: "Files", exact: true }).click();
  await page.getByRole("tab", { name: "Workspace" }).click();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("textbox", { name: "Folder name" }).fill(FOLDER);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/folder=Seed/);
  await page.getByRole("button", { name: "Upload" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Files" }).click();
  await (await chooser).setFiles({
    name: DOCUMENT,
    mimeType: "application/pdf",
    buffer: PDF,
  });
  await page.getByRole("link", { name: DOCUMENT }).waitFor();
  await page.getByRole("button", { name: `Data room for ${FOLDER}` }).click();
  await page.getByRole("button", { name: "Make data room" }).click();
  // Making the room opens it on its People tab, ready to invite.
  await page.waitForURL(/\/drive\/data-rooms\//);
  await page.getByRole("tab", { name: "People (0)" }).waitFor();
  // The button counts the addresses: "Invite 2".
  const invite = page.getByRole("button", { name: /^Invite( \d+)?$/ });
  await fillUntilEnabled(
    page.getByRole("textbox", { name: "Invite by email" }),
    viewers.join("\n"),
    invite,
  );
  await invite.click();
  await page.getByText("2 invitations sent").waitFor();
  await page.getByRole("button", { name: "Copy link" }).click();
  return page.evaluate(() => navigator.clipboard.readText());
}

async function enterRoom(page: Page, link: string, mailbox: Mailbox) {
  await page.goto(link);
  await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
  await page.getByRole("button", { name: "Send code" }).click();
  await page
    .getByRole("textbox", { name: "Code" })
    .fill(await mailbox.nextCode(90_000, /code/i));
  await page.getByRole("button", { name: "Open data room" }).click();
  await page.getByRole("heading", { name: `Welcome to ${FOLDER}` }).waitFor();
}

/** Ticks or unticks sharing on the only question and saves it. */
async function answer(page: Page, shared: boolean, saved: string) {
  const box = page.getByRole("checkbox", {
    name: "Show to everyone in the room",
  });
  await box.setChecked(shared);
  await page.getByRole("button", { name: /answer/i }).click();
  await page.getByText(saved, { exact: true }).waitFor();
}

for (const { name, ...viewport } of PROJECTS) {
  describe(name, () => {
    test("an owner shares one answer with the whole data room", async () => {
      const [owner, first, second] = [
        await createMailbox(),
        await createMailbox(),
        await createMailbox(),
      ];
      const errors: string[] = [];
      const open = async (size: typeof viewport) => {
        const context = await browser.newContext({ viewport: size });
        const page = await context.newPage();
        page.setDefaultTimeout(60_000);
        page.on("pageerror", (e) => errors.push(e.message));
        return { context, page };
      };
      const shot = (page: Page, step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}data-room-shared-answers-${name}-${step}.png`,
        });

      // Setup runs where the sidebar is; the feature screens run at `name`.
      const founder = await open(DESKTOP);
      await founder.context.grantPermissions([
        "clipboard-read",
        "clipboard-write",
      ]);
      await signUp(founder.page, owner);
      const link = await makeRoom(founder.page, [
        first.address,
        second.address,
      ]);
      assert.match(link, /\/share\/rooms\//);

      const asker = await open(viewport);
      await enterRoom(asker.page, link, first);
      await asker.page
        .getByRole("button", { name: /Key metrics/ })
        .first()
        .click();
      const ask = asker.page.getByRole("button", { name: "Ask" });
      await fillUntilEnabled(
        asker.page.getByRole("textbox", {
          name: "Ask the owner about this document",
        }),
        QUESTION,
        ask,
      );
      await ask.click();
      await asker.page.getByText("Waiting for an answer").waitFor();

      await founder.page.setViewportSize(viewport);
      await founder.page.getByRole("tab", { name: "Questions" }).click();
      await fillUntilEnabled(
        founder.page.getByRole("textbox", { name: "Answer" }),
        ANSWER,
        founder.page.getByRole("button", { name: "Answer", exact: true }),
      );
      await answer(founder.page, false, "Answer saved");

      const other = await open(viewport);
      await enterRoom(other.page, link, second);
      const sharedList = other.page.getByRole("heading", {
        name: "Answered for everyone",
        exact: true,
      });
      assert.equal(await sharedList.count(), 0, "private until shared");

      await answer(founder.page, true, "Answer saved and shared with the room");
      await shot(founder.page, "1-owner-shares");
      await other.page.reload();
      await sharedList.waitFor();
      await other.page.getByText(ANSWER).waitFor();
      const welcome = await other.page.getByRole("main").innerText();
      assert.ok(!welcome.includes(first.address), "never says who asked");
      await shot(other.page, "2-welcome-shared");

      await answer(founder.page, false, "Answer saved");
      await other.page.reload();
      await other.page
        .getByRole("heading", { name: `Welcome to ${FOLDER}` })
        .waitFor();
      // The Welcome page's status line empties once the answers have loaded.
      await other.page.waitForFunction(
        () => document.querySelector("main [role=status]")?.textContent === "",
      );
      assert.equal(await sharedList.count(), 0, "unshared answer is gone");

      for (const { context } of [founder, asker, other]) await context.close();
      assert.deepEqual(errors, []);
    });
  });
}
