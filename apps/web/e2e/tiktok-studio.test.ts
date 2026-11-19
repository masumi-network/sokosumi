import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user's first visit to TikTok Studio: reach it through the app's own
// navigation (the You page on a phone, the sidebar elsewhere), create a
// project from its prompt, and pick a presenter: the voice follows them.
// Making a video costs credits, so the spec stops before "Make video". Each
// size signs up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const SIZES = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

async function openTikTokStudio(page: Page) {
  const you = page.getByRole("link", { name: "You", exact: true });
  const showSidebar = page.getByRole("button", { name: "Show sidebar" });
  const sidebarRow = page.getByRole("link", {
    name: "TikTok Studio",
    exact: true,
  });
  await you.or(showSidebar).or(sidebarRow).first().waitFor();
  if (await you.isVisible()) {
    await you.click();
    await page.getByTestId("you-tiktok-studio").click();
  } else {
    if (await showSidebar.isVisible()) await showSidebar.click();
    await sidebarRow.click();
  }
}

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  console.log(`E2E_BASE_URL=${BASE_URL}`);
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name: size, ...viewport } of SIZES) {
  describe(size, () => {
    test("a new user sets up a talking video and the voice follows the presenter", async () => {
      const mailbox = await createMailbox();
      const context = await browser.newContext({
        viewport,
        isMobile: size !== "desktop",
        hasTouch: size !== "desktop",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}tiktok-studio-${size}-${step}.png`,
        });

      await page.goto(`${BASE_URL}/signup`);
      await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByRole("textbox", { name: "First name" }).fill("E2E");
      await page.getByRole("textbox", { name: "Last name" }).fill("Tester");
      await page
        .getByRole("textbox", { name: "Code from the email" })
        .pressSequentially(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("link", { name: "Later" }).click();
      await page.waitForURL(`${BASE_URL}/`);

      await openTikTokStudio(page);
      const prompt = page.getByRole("region", { name: "Choose a project" });
      await prompt.getByRole("button", { name: "Create project" }).click();
      const wizard = page.getByRole("dialog", { name: "New project" });
      await wizard.getByLabel("Project name").fill("E2E coffee roaster");
      await wizard.getByRole("button", { name: "Continue" }).click();
      await wizard.getByRole("button", { name: "Continue" }).click();
      await wizard.getByRole("button", { name: "Create project" }).click();
      // Closing the finished wizard keeps the studio, now on the new project.
      await wizard.getByRole("button", { name: "Close" }).click();
      await page.waitForURL(/\/tiktok-studio\?projectId=/);

      const form = page.getByRole("form", { name: "New talking video" });
      const voice = form.getByRole("combobox", { name: "Voice" });
      await form.getByRole("radio", { name: "Maya" }).waitFor();
      assert.equal(await voice.textContent(), "Sarah");
      await shot("1-studio");

      await form.getByRole("radio", { name: "Jonas" }).click();
      assert.equal(await voice.textContent(), "Chris");
      await page.getByText("Voice: Chris").waitFor();
      await shot("2-jonas");

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert.ok(overflow <= 1, `page is ${overflow}px wider than the screen`);
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
