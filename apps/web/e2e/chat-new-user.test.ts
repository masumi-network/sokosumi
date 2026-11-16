import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";

/**
 * A brand-new user's first chat: sign up with a disposable mail.tm inbox,
 * create an Organization, start an External channel from the first Catch up
 * and post in it. Then the chat list must not claim "No channels yet." beside
 * that channel.
 */
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const MAIL_API = "https://api.mail.tm";

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function mail(path: string, init: RequestInit = {}, token?: string) {
  // mail.tm allows a few requests per second; wait out a 429 and retry.
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(MAIL_API + path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (response.status === 429 && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    assert.ok(response.ok, `mail.tm ${path}: ${response.status}`);
    return response.json();
  }
}

async function createInbox() {
  const domains = await mail("/domains");
  const domain = domains["hydra:member"].find(
    (d: { isActive: boolean }) => d.isActive,
  ).domain;
  const address = `soko-e2e-${randomBytes(4).toString("hex")}@${domain}`;
  const password = randomBytes(16).toString("base64url");
  const body = JSON.stringify({ address, password });
  await mail("/accounts", { method: "POST", body });
  const { token } = await mail("/token", { method: "POST", body });
  return { address, token: token as string };
}

async function waitForCode(token: string): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const list = await mail("/messages", {}, token);
    for (const { id } of list["hydra:member"]) {
      const message = await mail(`/messages/${id}`, {}, token);
      const code = `${message.subject} ${message.text}`.match(/\b\d{6}\b/);
      if (code) return code[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("No sign-up code arrived");
}

async function signUpWithOrganization(page: Page) {
  const inbox = await createInbox();
  await page.goto(`${BASE_URL}/signup`);
  await page.locator('[data-testid="auth-field-email"]').fill(inbox.address);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByRole("textbox", { name: "First name" }).fill("Ada");
  await page.getByRole("textbox", { name: "Last name" }).fill("Tester");
  await page
    .getByRole("textbox", { name: "Code from the email" })
    .fill(await waitForCode(inbox.token));
  await page.getByRole("button", { name: "Register" }).click();

  await page.getByRole("radio", { name: /Organization/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Ada Test Studio");
  await page
    .getByRole("textbox", { name: "Website" })
    .fill("https://example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.getByRole("button", { name: "Go to workspace" }).click();
  await page.getByRole("link", { name: "Later" }).click();
  await page.waitForURL(`${BASE_URL}/`);
}

for (const { name, isMobile, ...viewport } of PROJECTS) {
  describe(name, () => {
    let browser: Browser;
    before(async () => {
      mkdirSync(RESULTS_DIR, { recursive: true });
      browser = await chromium.launch();
    });
    after(() => browser.close());

    test("new user starts an External channel from Catch up and posts in it", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await signUpWithOrganization(page);
      if (name === "phone") {
        await page
          .getByRole("navigation", { name: "Main navigation" })
          .getByRole("link", { name: "Chats" })
          .click();
      }
      // The tablet layout keeps the sidebar behind a toggle.
      const showSidebar = page.getByRole("button", { name: "Show sidebar" });
      if (name === "tablet") await showSidebar.click();
      // The chat list redraws once rooms load; a tap before that can be lost.
      await page.getByText("No direct messages yet.").waitFor();
      // A first Catch up says what it is for and starts the first channel.
      await page.getByRole("link", { name: "Catch up" }).first().click();
      await page.getByText("Nothing to catch up on yet").waitFor();
      const caughtUp = await page.getByText("You're caught up").count();
      // Nobody else is in this new organization, so there is no one to message.
      const messageTeammate = await page
        .getByRole("button", { name: "Message a teammate" })
        .count();
      await page.getByRole("button", { name: "Create a channel" }).click();
      // Typed, not filled: the handle drives the name and an availability check.
      await page
        .getByRole("textbox", { name: "Handle" })
        .pressSequentially("launch-plans", { delay: 30 });
      await page.getByRole("radio", { name: "External" }).click();
      await page.getByRole("button", { name: "Next" }).click();
      await page.getByRole("button", { name: "Create" }).click();
      await page.waitForURL(/\/chat\/rooms\//);

      const composer = page.getByRole("textbox", {
        name: "Message #Launch Plans",
      });
      await composer.fill("Kickoff notes for the spring launch go here.");
      await page.getByRole("button", { name: "Send message" }).click();
      await page
        .getByText("Kickoff notes for the spring launch go here.")
        .last()
        .waitFor();

      if (name === "phone") {
        await page.getByRole("link", { name: "Back to chats" }).click();
        await page.waitForURL(`${BASE_URL}/chat`);
      }
      if (name === "tablet" && (await showSidebar.isVisible())) {
        await showSidebar.click();
      }
      await page.getByRole("link", { name: "Launch Plans" }).first().waitFor();
      await page.screenshot({
        path: `${RESULTS_DIR}${name}-chat-new-user.png`,
      });
      const noChannels = await page.getByText("No channels yet.").count();
      await context.close();

      assert.equal(caughtUp, 0, '"You\'re caught up" before any room');
      assert.equal(messageTeammate, 0, "Message a teammate with no teammates");
      assert.equal(noChannels, 0, '"No channels yet." beside the new channel');
      assert.deepEqual(errors, []);
    });
  });
}
