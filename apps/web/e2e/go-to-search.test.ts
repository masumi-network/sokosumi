import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Locator, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

// A new user jumps to a Project and a channel from search: sign up with an
// Organization, create a Project and a channel, go to Tasks, open search and
// type part of each name. The Projects group opens the Project page; the
// Channels group opens the channel. Each size signs up its own disposable
// mail.tm inbox. Free only.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const PROJECT = "Harbor Relaunch";
const CHANNEL_HANDLE = "harbor-crew";
const CHANNEL = "Harbor Crew";

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}go-to-search-${size}-${step}.png`,
  });
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
}

async function openSearch(page: Page, size: string, query: string) {
  if (size === "phone") {
    await page.getByTestId("header-mobile-search-trigger").tap();
  } else {
    const showSidebar = page.getByRole("button", { name: "Show sidebar" });
    if (await showSidebar.isVisible()) await showSidebar.click();
    await page.getByRole("button", { name: "Search", exact: true }).click();
  }
  const dialog = page.getByRole("dialog", { name: "Search" });
  const input = dialog.getByRole("combobox");
  await input.waitFor();
  if (size === "phone") await page.keyboard.type(query);
  else await input.fill(query);
  return dialog;
}

async function press(locator: Locator, size: string) {
  if (size === "phone") await locator.tap();
  else await locator.click();
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
    test("a new user opens a Project and a channel from search", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await signUpWithOrganization(page, BASE_URL);

      // Organization setup may already have made a Project from the website.
      await page.goto(`${BASE_URL}/projects`);
      await page
        .getByRole("button", { name: /^(New project|Create project)$/ })
        .filter({ visible: true })
        .first()
        .click();
      const wizard = page.getByRole("dialog", { name: "New project" });
      await wizard.getByLabel("Project name").fill(PROJECT);
      await wizard.getByRole("button", { name: "Continue" }).click();
      await wizard.getByRole("button", { name: "Continue" }).click();
      await wizard.getByRole("button", { name: "Create project" }).click();
      await page.waitForURL(/\/projects\/[^/?]+$/);
      const projectUrl = page.url();

      await page.goto(`${BASE_URL}/chat`);
      if (size === "tablet") {
        await page.getByRole("button", { name: "Show sidebar" }).click();
      }
      // The chat list redraws once rooms load; a tap before that can be lost.
      await page
        .getByText("No direct messages yet.")
        .filter({ visible: true })
        .first()
        .waitFor();
      await page.getByRole("button", { name: "Create channel" }).click();
      await page
        .getByRole("textbox", { name: "Handle" })
        .pressSequentially(CHANNEL_HANDLE, { delay: 30 });
      await page.getByRole("button", { name: "Next" }).click();
      await page.getByRole("button", { name: "Create" }).click();
      await page.waitForURL(/\/chat\/rooms\//);
      const channelUrl = page.url();

      // Search from another page, by part of the shared word.
      await page.goto(`${BASE_URL}/tasks`);
      await page.getByRole("heading", { name: "Backlog" }).waitFor();
      const search = await openSearch(page, size, "harb");
      const project = search
        .getByRole("group", { name: "Projects" })
        .getByRole("option", { name: PROJECT });
      const channel = search
        .getByRole("group", { name: "Channels" })
        .getByRole("option", { name: CHANNEL });
      await project.waitFor();
      await channel.waitFor();
      assert.equal(
        await search.getByText("No results found").count(),
        0,
        "search says No results found next to matches",
      );
      await noSidewaysScroll(page);
      await shot(page, size, "1-search");

      await press(project, size);
      await page.waitForURL(projectUrl);
      await page.getByRole("heading", { level: 1, name: PROJECT }).waitFor();
      await shot(page, size, "2-project");

      const again = await openSearch(page, size, "crew");
      await press(
        again
          .getByRole("group", { name: "Channels" })
          .getByRole("option", { name: CHANNEL }),
        size,
      );
      await page.waitForURL(channelUrl);
      await noSidewaysScroll(page);
      await shot(page, size, "3-channel");

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
