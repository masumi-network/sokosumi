import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new owner signs up into an Organization, makes two Projects, features
// one for everyone, switches the feature to the other, then stops featuring.
// Each size signs up a new throwaway user; nothing is paid for or sent.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];
const FIRST = "Spring launch";
const SECOND = "Partner newsletter";

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
});
after(() => browser.close());

async function createProject(page: Page, name: string) {
  await page.getByRole("textbox", { name: "Filter projects" }).waitFor();
  const main = page.getByRole("main");
  // Below md the floating button creates; from md the toolbar button does.
  const toolbar = main.getByRole("button", { name: "New project" });
  await ((await toolbar.isVisible())
    ? toolbar
    : page.getByRole("button", { name: "Create project" })
  ).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByRole("textbox", { name: "Project name" }).fill(name);
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("textbox", { name: "Briefing" }).fill(`${name} work`);
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("heading", { level: 1, name }).waitFor();
  // The way back differs per size (sidebar, breadcrumb, header Back), and
  // the list is what this spec checks, so it reloads it directly.
  await page.goto(`${BASE_URL}/projects`);
}

/** The menu of the grid card whose link names the Project. */
async function openCardMenu(page: Page, name: string) {
  const card = page
    .getByRole("article")
    .filter({ has: page.getByRole("link", { name: new RegExp(name) }) });
  await card.getByRole("button", { name: "More actions" }).click();
}

for (const { name, ...viewport } of PROJECTS) {
  describe(name, () => {
    test("an owner features a Project for everyone", async () => {
      const mailbox = await createMailbox();
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}featured-${name}-${step}.png`,
        });

      await page.goto(`${BASE_URL}/`);
      await page.getByRole("link", { name: "Register" }).click();
      // Sign-in has an Email box too: wait for sign-up before typing.
      await page.waitForURL(/\/signup/);
      await page
        .getByRole("main")
        .getByRole("heading", { name: "Create your account" })
        .waitFor();
      await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByRole("textbox", { name: "First name" }).fill("Ada");
      await page.getByRole("textbox", { name: "Last name" }).fill(name);
      await page
        .getByRole("textbox", { name: "Code from the email" })
        .pressSequentially(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();

      await page.waitForURL(/\/setup$/);
      await page.getByRole("radio", { name: /Organization/ }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      const wizard = page.getByRole("dialog", { name: "Create organization" });
      await wizard.getByRole("textbox", { name: "Name" }).fill(`Ada ${name}`);
      await wizard
        .getByRole("textbox", { name: "Website" })
        .fill("https://example.com");
      await wizard.getByRole("button", { name: "Continue" }).click();
      await wizard.getByRole("button", { name: "Skip for now" }).click();
      await wizard.getByRole("button", { name: "Finish setup" }).click();
      await wizard.getByRole("button", { name: "Go to workspace" }).click();
      await page.waitForURL(/\/setup\/assistant$/);
      await page.getByRole("link", { name: "Later" }).click();

      await page.waitForURL(`${BASE_URL}/`);
      await page.goto(`${BASE_URL}/projects`);
      await createProject(page, FIRST);
      await createProject(page, SECOND);

      const featured = page.getByRole("region", {
        name: "Featured by your team",
      });
      await openCardMenu(page, FIRST);
      await page
        .getByRole("menuitem", { name: "Feature for everyone" })
        .click();
      await featured
        .getByRole("link", { name: `Open project ${FIRST}` })
        .waitFor();
      await shot("1-featured");

      // Featuring another Project replaces the first: one per organization.
      await openCardMenu(page, SECOND);
      await page
        .getByRole("menuitem", { name: "Feature for everyone" })
        .click();
      await featured
        .getByRole("link", { name: `Open project ${SECOND}` })
        .waitFor();
      await shot("2-switched");

      await openCardMenu(page, SECOND);
      await page.getByRole("menuitem", { name: "Stop featuring" }).click();
      await featured.waitFor({ state: "detached" });
      await shot("3-stopped");

      await context.close();
      assert.deepEqual(errors, []);
    });
  });
}
