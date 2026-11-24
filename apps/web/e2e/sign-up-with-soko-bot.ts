import assert from "node:assert/strict";

import type { Page } from "playwright";

import { createMailbox } from "./mailbox.ts";

async function expectStep(page: Page, path: RegExp, heading: string) {
  await page.waitForURL(path);
  await page
    .getByRole("main")
    .getByRole("heading", { name: heading })
    .waitFor();
}

/**
 * Registers a new throwaway user from the root, takes the quickest setup
 * (Personal workspace, a Soko Bot named `bot`, no mail connected) and waits
 * in the bot's chat for its welcome. With `leaveAtConnect` the user stops at
 * the Connect step and opens the app again, so the welcome is never seen.
 * Nothing is paid for or connected.
 */
export async function signUpWithSokoBot(
  page: Page,
  baseUrl: string,
  {
    bot,
    lastName,
    leaveAtConnect = false,
  }: { bot: string; lastName: string; leaveAtConnect?: boolean },
) {
  const mailbox = await createMailbox();
  await page.goto(`${baseUrl}/`);
  await page.getByRole("link", { name: "Register" }).click();
  await expectStep(page, /\/signup/, "Create your account");
  const chip = page.getByRole("button", {
    name: `${mailbox.address} Change email`,
  });
  for (let attempt = 0; !(await chip.isVisible()); attempt++) {
    assert.ok(attempt < 3, "the email step never took the address");
    await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
    await page.getByRole("button", { name: "Continue with email" }).click();
    await chip.waitFor({ timeout: 10_000 }).catch(() => {});
  }
  await page.getByRole("textbox", { name: "First name" }).fill("Mira");
  await page.getByRole("textbox", { name: "Last name" }).fill(lastName);
  await page
    .getByRole("textbox", { name: "Code from the email" })
    .pressSequentially(await mailbox.nextCode());
  await page.getByRole("button", { name: "Register" }).click();
  await expectStep(page, /\/setup$/, "How do you want to work?");
  await page.getByRole("button", { name: "Continue" }).click();
  await expectStep(page, /\/setup\/assistant$/, "Name your Soko Bot");
  await page.getByRole("textbox", { name: "Name" }).fill(bot);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: `Create ${bot}` }).click();
  await page.waitForURL(/\/setup\/assistant\/connect$/);
  if (leaveAtConnect) {
    await page.goto(`${baseUrl}/`);
    return;
  }
  await page.getByRole("link", { name: "Skip" }).click();
  await page.waitForURL(/\/chat\/rooms\//);
  await page.getByRole("main").getByText(`I'm ${bot}`).waitFor();
}

/** Home through the app's own navigation, from anywhere in the app. */
export async function openHome(page: Page, isPhone: boolean) {
  if (isPhone) {
    // A phone's chat room hides the tab bar; its Back shows it again.
    const back = page.getByRole("link", { name: "Back to chats" });
    if (await back.isVisible()) await back.click();
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Home" })
      .click();
  } else {
    const showSidebar = page.getByRole("button", { name: "Show sidebar" });
    if (await showSidebar.isVisible()) await showSidebar.click();
    await page.getByRole("link", { name: "Home", exact: true }).click();
  }
}
