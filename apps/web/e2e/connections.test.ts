import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user per size (disposable mail.tm inbox) opens Connections through
// the app's own navigation. Connected apps finishes loading into its empty
// state and says so in its status region; a filter that matches nothing
// leaves no empty Sign-in or apps box behind; returning from the MCP tab
// shows the list at once and reads it again in the background. Signs up
// nobody else and connects no account.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}connections-${size}-${step}.png`,
  });
}

async function openConnections(page: Page, size: string) {
  if (size === "phone") {
    // Home forwards to /chat after sign-up; a tap during that hop is lost,
    // so tap You again until the You page opens.
    const you = page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "You" });
    for (let attempt = 0; attempt < 3; attempt++) {
      await you.click();
      const opened = await page
        .waitForURL(`${BASE_URL}/you`, { timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (opened) break;
    }
    await page
      .getByRole("navigation", { name: "You" })
      .getByRole("link", { name: "Connections", exact: true })
      .click();
  } else {
    // The tablet collapses the sidebar; the desktop keeps it open.
    if (size === "tablet") {
      await page.getByRole("button", { name: "Show sidebar" }).click();
    }
    await page.getByRole("button", { name: /^Open account summary/ }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Connections", exact: true })
      .click();
  }
  await page.waitForURL(`${BASE_URL}/connections`);
}

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  console.log(`E2E_BASE_URL=${BASE_URL}`);
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name: size, isMobile, ...viewport } of PROJECTS) {
  describe(size, () => {
    test("a new user reads Connections' loading, empty and no-match states", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      let consentReads = 0;
      page.on("request", (request) => {
        if (request.url().includes("/oauth2/get-consents")) consentReads++;
      });

      const mailbox = await createMailbox();
      await page.goto(`${BASE_URL}/signup`);
      // The cookie banner covers the form on a phone; it shows once the page
      // has hydrated, so waiting for it also keeps the typed email.
      await page
        .getByRole("button", { name: "Reject non-essential" })
        .click({ timeout: 15_000 })
        .catch(() => {});
      await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByRole("textbox", { name: "First name" }).fill("E2E");
      await page
        .getByRole("textbox", { name: "Last name" })
        .fill("Connections");
      await page
        .getByRole("textbox", { name: "Code from the email" })
        .fill(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("link", { name: "Later" }).click();
      const origin = new URL(BASE_URL).origin;
      await page.waitForURL(
        (url) =>
          url.origin === origin &&
          (url.pathname === "/" || url.pathname === "/chat"),
      );

      await openConnections(page, size);
      await page
        .getByRole("heading", { name: "Connections", level: 1 })
        .waitFor();
      const apps = page.getByRole("tabpanel", { name: "Connected apps" });
      const status = apps.getByRole("status");
      await apps.getByText("No applications have been authorized.").waitFor();
      assert.equal(await status.textContent(), "Connected apps loaded");
      await shot(page, size, "1-empty");

      // A filter that matches nothing leaves no empty Sign-in list box.
      const filter = page.getByRole("searchbox", { name: "Filter this list" });
      await filter.fill("github");
      await page.getByText("No matches").waitFor();
      const signIn = page.getByTestId("connections-sign-in");
      assert.equal(
        await signIn.locator(".rounded-xl.border").count(),
        0,
        "empty Sign-in box left behind",
      );
      await shot(page, size, "2-no-match");
      await filter.fill("");

      // Back from MCP: the list shows at once and is read again.
      await page.getByRole("tab", { name: "MCP" }).click();
      await page.getByText("MCP server URL").waitFor();
      const readsBefore = consentReads;
      await page.getByRole("tab", { name: "Connected apps" }).click();
      await apps.getByText("No applications have been authorized.").waitFor({
        timeout: 2_000,
      });
      assert.equal(
        await page.getByTestId("authorized-clients-loading").count(),
        0,
        "skeleton shown on tab return",
      );
      const deadline = Date.now() + 15_000;
      while (consentReads === readsBefore && Date.now() < deadline) {
        await page.waitForTimeout(250);
      }
      assert.ok(consentReads > readsBefore, "no background read on tab return");
      await shot(page, size, "3-tab-return");

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
