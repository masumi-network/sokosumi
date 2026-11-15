import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";

const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];
const PAGES = ["/signin", "/signup"];

// Known app defect, not a harness bug: the signed-out proxy redirects Vercel's
// hashed first-party analytics script (`/<16 hex>/script.js`) to `/signin`, so
// the browser refuses the HTML as a script. Remove once the proxy lets it pass.
const KNOWN_ERROR = /Refused to execute script .*%2F[0-9a-f]{16}%2Fscript\.js/;

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name, ...viewport } of PROJECTS) {
  describe(name, () => {
    for (const path of PAGES) {
      test(`${path} loads without overflow or console errors`, async () => {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
          if (m.type() === "error" && !KNOWN_ERROR.test(m.text()))
            errors.push(m.text());
        });

        const response = await page.goto(BASE_URL + path);
        assert.ok(response?.ok(), `${path} status ${response?.status()}`);
        await page
          .locator('[data-testid="auth-field-email"]')
          .waitFor({ state: "visible" });
        await page.waitForLoadState("load");

        await page.screenshot({
          path: `${RESULTS_DIR}${name}${path.replace("/", "-")}.png`,
        });
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        await context.close();
        assert.equal(overflow, 0, `${path} overflows by ${overflow}px`);
        assert.deepEqual(errors, []);
      });
    }
  });
}
