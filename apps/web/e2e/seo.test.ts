import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user's first SEO audit, end to end: reach SEO through the app's own
// navigation (the You page on a phone, the sidebar elsewhere), start an audit
// from a bare domain, add a second page the same way, and track a keyword with
// the code format the fields describe. Saving pages and keywords is free; no
// check runs. Each size signs up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

async function openSeo(page: Page) {
  const you = page.getByRole("link", { name: "You", exact: true });
  const showSidebar = page.getByRole("button", { name: "Show sidebar" });
  const sidebarSeo = page.getByRole("link", { name: "SEO", exact: true });
  await you.or(showSidebar).or(sidebarSeo).first().waitFor();
  if (await you.isVisible()) {
    await you.click();
    await page.getByTestId("you-seo").click();
  } else {
    if (await showSidebar.isVisible()) await showSidebar.click();
    await sidebarSeo.click();
  }
}

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  console.log(`E2E_BASE_URL=${BASE_URL}`);
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name: size, ...viewport } of PROJECTS) {
  describe(size, () => {
    test("a new user starts an SEO audit from a bare domain", async () => {
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
        page.screenshot({ path: `${RESULTS_DIR}seo-${size}-${step}.png` });

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

      await openSeo(page);
      await page
        .getByRole("heading", { name: "Start your first SEO audit" })
        .waitFor();
      await page
        .getByRole("textbox", { name: "First page URL" })
        .fill("example.com");
      await shot("1-first-page");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForURL(/\/seo\?auditId=/);
      await page.getByRole("heading", { name: "Set up this audit" }).waitFor();

      // Phones go back to You, where SEO was opened.
      if (size === "phone")
        assert.equal(
          await page
            .getByRole("link", { name: "Back", exact: true })
            .getAttribute("href"),
          "/you",
        );

      await page.getByRole("button", { name: "Add a page" }).click();
      const addPage = page.getByRole("dialog", { name: "Add a page" });
      await addPage
        .getByRole("textbox", { name: "Page URL" })
        .fill("example.com/about");
      await addPage.getByRole("button", { name: "Save" }).click();
      await page.getByText("2 pages are in this audit.").waitFor();
      await shot("2-pages");

      await page.getByRole("tab", { name: "Rankings" }).click();
      await page.getByRole("button", { name: "Add a keyword" }).click();
      const track = page.getByRole("dialog", { name: "Track a keyword" });
      await track
        .getByRole("textbox", { name: "Keyword" })
        .fill("example domain");
      const country = track.getByRole("textbox", { name: "Country code" });
      const language = track.getByRole("textbox", { name: "Language code" });
      assert.equal(
        await country.getAttribute("aria-describedby"),
        "seo-edit-country-help",
      );
      await track.getByText("Two letters, like US or DE.").waitFor();
      await track.getByText("Like en or de.").waitFor();
      await country.fill("DE");
      await language.fill("de");
      await shot("3-keyword");
      await track.getByRole("button", { name: "Save" }).click();
      await page.getByText("Germany · German").waitFor();

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
