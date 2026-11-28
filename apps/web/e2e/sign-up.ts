import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import type { Page } from "playwright";

const MAIL_API = "https://api.mail.tm";

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

/** The Organization's invite link from setup's last step, once it fills in. */
async function readInviteLink(page: Page, baseUrl: string): Promise<string> {
  const field = page.getByRole("textbox", { name: "Invite link" });
  let link = await field.inputValue();
  for (let poll = 0; poll < 50 && !link; poll++) {
    await page.waitForTimeout(200);
    link = await field.inputValue();
  }
  const url = URL.canParse(link) ? new URL(link) : null;
  // The link carries a join token, so a failure names what is wrong, never
  // the link itself; its actual and expected values are only booleans.
  const sameOrigin = url?.origin === new URL(baseUrl).origin;
  const joinPath = url?.pathname.startsWith("/join/") === true;
  assert.ok(
    sameOrigin && joinPath,
    `setup showed no usable invite link (parsed: ${url != null}, same origin: ${sameOrigin}, join path: ${joinPath})`,
  );
  return link;
}

/**
 * Signs a brand-new user up with a disposable mail.tm inbox and creates their
 * Organization, landing on Welcome home. With `inviteLink`, also returns the
 * Organization's invite link, which lets a teammate join without an email
 * invite.
 */
export async function signUpWithOrganization(
  page: Page,
  baseUrl: string,
): Promise<void>;
export async function signUpWithOrganization(
  page: Page,
  baseUrl: string,
  options: { inviteLink: true },
): Promise<string>;
export async function signUpWithOrganization(
  page: Page,
  baseUrl: string,
  options?: { inviteLink: true },
): Promise<string | void> {
  const inbox = await createInbox();
  await page.goto(`${baseUrl}/signup`);
  // The cookie banner covers the form's buttons on a phone. It shows once the
  // page has hydrated, so waiting for it also keeps the email typed below:
  // React resets a field typed into before hydration.
  await page
    .getByRole("button", { name: "Reject non-essential" })
    .click({ timeout: 15_000 })
    .catch(() => {});
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
  const inviteLink = options?.inviteLink
    ? await readInviteLink(page, baseUrl)
    : undefined;
  await page.getByRole("button", { name: "Go to workspace" }).click();
  await page.getByRole("link", { name: "Later" }).click();
  // Home forwards to /chat; either, on this preview, is the end of setup.
  const origin = new URL(baseUrl).origin;
  await page.waitForURL(
    (url) =>
      url.origin === origin &&
      (url.pathname === "/" || url.pathname === "/chat"),
  );
  return inviteLink;
}
