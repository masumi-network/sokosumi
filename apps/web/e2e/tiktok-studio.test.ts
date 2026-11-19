import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user's first visit to TikTok Studio: reach it through the app's own
// navigation (the You page on a phone, the sidebar elsewhere), create a
// project from its prompt, pick a presenter (the voice follows them), write a
// script, read the cost, then switch to their own photo and confirm consent.
// Making a video costs credits, so the spec stops before "Make video", and a
// new user has no video yet to open on the stage. Each size signs up its own
// disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

// A 1x1 PNG: the photo is only uploaded to the person's Files here, never
// turned into a video.
const PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const SCRIPT =
  "Stop scrolling. Most people grind their coffee too fine for a French press.";

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

      const make = form.getByRole("button", { name: "Make video" });
      assert.equal(await make.isDisabled(), true, "no script, no video");
      await form.getByRole("textbox", { name: "Script" }).fill(SCRIPT);
      await form.getByText(/^\d+ credits$/).waitFor();
      await form.getByText(/charged only when the video is ready/).waitFor();
      assert.equal(await make.isEnabled(), true, "a script shows the cost");
      // The preview shows the script as captions.
      await page
        .getByRole("region", { name: "Preview" })
        .getByText(/^Stop scrolling\. Most people/)
        .waitFor();
      await shot("3-cost");

      const chooser = page.waitForEvent("filechooser");
      await form.getByRole("button", { name: "You" }).click();
      await (await chooser).setFiles({
        name: "me.png",
        mimeType: "image/png",
        buffer: PHOTO,
      });
      const consent = form.getByRole("checkbox", {
        name: /I am the person in this photo/,
      });
      await consent.waitFor();
      assert.equal(
        await form.getByRole("radio", { name: "You" }).isChecked(),
        true,
      );
      await form.getByText("Confirm that you may use this photo.").waitFor();
      assert.equal(await make.isDisabled(), true, "no consent, no video");
      await consent.click();
      await form.getByText(/^\d+ credits$/).waitFor();
      assert.equal(await make.isEnabled(), true, "consent unlocks the video");
      await shot("4-own-photo");

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert.ok(overflow <= 1, `page is ${overflow}px wider than the screen`);
      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
