import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";
import { signUpWithOrganization } from "./sign-up.ts";

/**
 * Reply privately: an owner and a teammate (who joins by the Organization's
 * invite link, so no invite email is sent) share a channel. The teammate asks
 * a question there. The owner already has a half-written draft in their
 * Direct with the teammate, then picks Reply privately on the question: the
 * Direct opens with the question quoted and the draft still in the composer.
 * Nothing is sent.
 */
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

const QUESTION = "Can someone check the pricing section before Friday?";
const DRAFT = "Quick question about the brief:";

/** Signs a new teammate up through the invite link and joins the Organization. */
async function joinByInviteLink(page: Page, inviteLink: string) {
  const mailbox = await createMailbox();
  await page.goto(inviteLink);
  await page.getByRole("button", { name: "Create an account" }).click();
  await page
    .getByRole("button", { name: "Reject non-essential" })
    .click({ timeout: 15_000 })
    .catch(() => {});
  await page.locator('[data-testid="auth-field-email"]').fill(mailbox.address);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByRole("textbox", { name: "First name" }).fill("Jonas");
  await page.getByRole("textbox", { name: "Last name" }).fill("Weber");
  await page
    .getByRole("textbox", { name: "Code from the email" })
    .fill(await mailbox.nextCode());
  await page.getByRole("button", { name: "Register" }).click();
  await page.getByRole("button", { name: /^Join / }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/join"));
}

/** Shows the chat list: the Chats tab on a phone, the sidebar above. */
async function showChatList(page: Page, name: string) {
  if (name === "phone") {
    await page.goto(`${BASE_URL}/chat/rooms`);
    return;
  }
  const showSidebar = page.getByRole("button", { name: "Show sidebar" });
  if (await showSidebar.isVisible()) await showSidebar.click();
}

/** Opens a message's actions: the More menu on a pointer, the sheet on touch. */
async function replyPrivately(page: Page, name: string) {
  const row = page.getByRole("article").filter({ hasText: QUESTION });
  if (name === "desktop") {
    await row.hover();
    await row.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Reply privately" }).click();
    return;
  }
  // The sheet opens on a long press; its keyboard button does the same.
  await row.getByRole("button", { name: "Message actions" }).focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("dialog", { name: "Message actions" })
    .getByRole("button", { name: "Reply privately" })
    .click();
}

for (const { name, isMobile, ...viewport } of PROJECTS) {
  describe(name, () => {
    let browser: Browser;
    before(async () => {
      mkdirSync(RESULTS_DIR, { recursive: true });
      browser = await chromium.launch();
    });
    after(() => browser.close());

    test("Reply privately quotes the message and keeps the Direct draft", async () => {
      const contextOptions = { viewport, isMobile, hasTouch: isMobile };
      const ownerContext = await browser.newContext(contextOptions);
      const teammateContext = await browser.newContext(contextOptions);
      const owner = await ownerContext.newPage();
      const teammate = await teammateContext.newPage();
      const errors: string[] = [];
      owner.on("pageerror", (e) => errors.push(e.message));

      const inviteLink = await signUpWithOrganization(owner, BASE_URL, {
        inviteLink: true,
      });
      await joinByInviteLink(teammate, inviteLink);

      // A channel with everyone, the teammate included.
      await showChatList(owner, name);
      await owner
        .getByRole("button", { name: "Create channel" })
        .first()
        .click();
      await owner
        .getByRole("textbox", { name: "Name" })
        .pressSequentially("Spring Launch", { delay: 30 });
      await owner.getByText("#spring-launch").first().waitFor();
      await owner.getByRole("button", { name: "Next" }).click();
      await owner.getByRole("button", { name: "Create" }).click();
      await owner.waitForURL(/\/chat\/rooms\/[^/]+$/);
      const channelUrl = owner.url();

      // The teammate asks in the channel.
      await teammate.goto(channelUrl);
      await teammate
        .getByRole("textbox", { name: "Message #Spring Launch" })
        .pressSequentially(QUESTION);
      // On touch, Enter adds a line; the Send button sends.
      await teammate.getByRole("button", { name: "Send message" }).click();
      await teammate
        .getByRole("article")
        .filter({ hasText: QUESTION })
        .waitFor();

      // The owner starts a Direct with the teammate and leaves a draft there.
      await showChatList(owner, name);
      await owner
        .getByRole("button", { name: /^(Start a message|New direct message)$/ })
        .first()
        .click();
      await owner.getByRole("button", { name: /Jonas Weber/ }).click();
      await owner.getByRole("button", { name: "Create" }).click();
      const draftBox = owner.getByRole("textbox", {
        name: "Message Jonas Weber",
      });
      await draftBox.click();
      await draftBox.pressSequentially(DRAFT);
      // The composer stores a draft a moment after the last keystroke.
      await owner.waitForTimeout(1500);
      const directUrl = owner.url();

      // Back in the channel, Reply privately on the question.
      await owner.goto(channelUrl);
      await owner.getByRole("article").filter({ hasText: QUESTION }).waitFor();
      await replyPrivately(owner, name);

      await owner.waitForURL(directUrl);
      const quote = owner.getByRole("status", { name: "Quoting Jonas Weber" });
      await quote.waitFor();
      const quoteText = await quote.innerText();
      const draftText = await draftBox.innerText();
      await owner.screenshot({
        path: `${RESULTS_DIR}${name}-chat-reply-privately.png`,
      });
      const sentMessages = await owner.getByRole("article").count();
      await ownerContext.close();
      await teammateContext.close();

      assert.match(quoteText, /pricing section before Friday/);
      assert.equal(draftText.trim(), DRAFT, "the Direct draft is kept");
      assert.equal(sentMessages, 0, "nothing was sent");
      assert.deepEqual(errors, []);
    });
  });
}
