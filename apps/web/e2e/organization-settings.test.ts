import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Locator, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { signUpWithOrganization } from "./sign-up.ts";

/**
 * A new owner opens Settings: the daily stand-up asks for its time with a
 * time field and its zone from a list that includes UTC, and saving UTC
 * survives a reload. The setup's invite link keeps Copy link and Revoke on
 * screen at every size. Free only: the stand-up stays off, nothing is sent.
 */
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({
    path: `${RESULTS_DIR}organization-settings-${size}-${step}.png`,
  });
}

async function assertInside(locator: Locator, width: number, label: string) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert.ok(box, `${label} is on screen`);
  assert.ok(box.x >= 0, `${label} starts at ${box.x}`);
  assert.ok(
    box.x + box.width <= width,
    `${label} ends at ${box.x + box.width} on a ${width}px screen`,
  );
}

for (const { name, isMobile, ...viewport } of PROJECTS) {
  describe(name, () => {
    let browser: Browser;
    before(async () => {
      mkdirSync(RESULTS_DIR, { recursive: true });
      browser = await chromium.launch();
    });
    after(() => browser.close());

    test("stand-up saves UTC from the list; invite link actions fit", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await signUpWithOrganization(page, BASE_URL);
      await page.goto(`${BASE_URL}/organization`);

      const time = page.getByLabel("Time", { exact: true });
      await time.waitFor();
      assert.equal(await time.getAttribute("type"), "time");

      const zone = page.getByRole("combobox", { name: "Time zone" });
      await zone.click();
      await page.getByRole("option", { name: "UTC", exact: true }).click();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByText("Stand-up settings saved.").waitFor();
      await shot(page, name, "standup-saved");

      await page.reload();
      await page
        .getByRole("combobox", { name: "Time zone" })
        .filter({ hasText: "UTC" })
        .waitFor();

      const row = page
        .getByRole("row")
        .filter({ has: page.getByRole("button", { name: "Revoke" }) })
        .first();
      await assertInside(
        row.getByRole("button", { name: "Copy link" }),
        viewport.width,
        "Copy link",
      );
      await assertInside(
        row.getByRole("button", { name: "Revoke" }),
        viewport.width,
        "Revoke",
      );
      await shot(page, name, "invite-links");

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
