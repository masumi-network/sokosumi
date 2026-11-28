import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl, resolvePreviewCoreUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user downloads a Project's finished results as one PDF, leaving one out. A new user
// has no free way to get results from someone else, so they finish their own Draft Tasks
// with written results through their own API key, as a Coworker would through the API.
// Writes only on a PR preview, only to that user's own Project. The key stays in memory: it
// is never logged and no screenshot is taken while it shows.
const BASE_URL = resolveBaseUrl(process.env);
const CORE = (() => {
  try {
    return { url: resolvePreviewCoreUrl(BASE_URL), skip: false as const };
  } catch (error) {
    return { url: "", skip: (error as Error).message };
  }
})();
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const PROJECT = "Spring launch";
const TASKS = [
  {
    name: "Write the cafe launch email",
    result: "## Launch email\n\n**Subject:** Spring tea has landed",
  },
  {
    name: "Pick the launch date",
    result: "| Date | Step |\n| --- | --- |\n| 3 Mar | Launch email |",
  },
  { name: "Draft the cafe flyer text", result: "Spring, by the cup." },
];

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
}

async function createApiKey(page: Page) {
  await page.goto(`${BASE_URL}/developer/api-keys`);
  await page.getByRole("button", { name: "Create" }).click();
  const dialog = page.getByRole("dialog", { name: "Create new API key" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("E2E results");
  await dialog.getByRole("button", { name: "Create API key" }).click();
  const created = page.getByRole("dialog", { name: "New API key created" });
  const key = await created
    .getByRole("button")
    .filter({ hasNotText: /^(Done|Close)$/ })
    .first()
    .innerText();
  await created.getByRole("button", { name: "Done" }).click();
  return key.trim();
}

// Native fetch, not page.request: Playwright's DEBUG=pw:api prints request headers.
// No redirects, so the key goes only to the paired Core; failures report status only.
async function core(key: string, path: string, body: unknown) {
  const response = await fetch(`${CORE.url}/v1${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  assert.ok(response.ok, `POST ${path} failed with ${response.status}`);
  return ((await response.json()) as { data: { id: string } }).data;
}

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  console.log(`E2E_BASE_URL=${BASE_URL}`);
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name: size, isMobile, ...viewport } of PROJECTS) {
  describe(size, { skip: CORE.skip }, () => {
    test("a Project's chosen results download as one PDF", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
        acceptDownloads: true,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}project-results-download-${size}-${step}.png`,
        });

      const mailbox = await createMailbox();
      await page.goto(`${BASE_URL}/signup`);
      await page.getByLabel("Email").fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByLabel("First name").fill("E2E");
      await page.getByLabel("Last name").fill("Tester");
      await page
        .getByLabel("Code from the email")
        .fill(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("link", { name: "Later" }).click();
      await page.waitForURL(`${BASE_URL}/`);

      const key = await createApiKey(page);
      const project = await core(key, "/projects", { name: PROJECT });
      for (const { name, result } of TASKS) {
        const task = await core(key, "/tasks", {
          name,
          projectId: project.id,
          status: "DRAFT",
          assigneeId: null,
        });
        await core(key, `/tasks/${task.id}/events`, {
          status: "COMPLETED",
          comment: result,
        });
      }

      await page.goto(`${BASE_URL}/projects`);
      // The Project card; Recent activity rows name the Project too.
      await page.locator(`main a[href$="/projects/${project.id}"]`).click();
      const open = page.getByRole("button", { name: "Download results" });
      await open.waitFor();
      await noSidewaysScroll(page);
      await shot("1-overview");

      await open.click();
      const dialog = page.getByRole("dialog", { name: "Download results" });
      await dialog.getByText("3 of 3 selected").waitFor();
      // Oldest first, so the document reads in the order the work finished.
      const labels = await dialog.locator("li label").allInnerTexts();
      assert.deepEqual(
        labels.map((label) => label.split("\n")[0]),
        TASKS.map(({ name }) => name),
      );
      await dialog.getByText(TASKS[2].name).click();
      await dialog.getByText("2 of 3 selected").waitFor();
      await noSidewaysScroll(page);
      await shot("2-picked");

      const [pdf] = await Promise.all([
        page.waitForEvent("download", { timeout: 90_000 }),
        dialog.getByRole("button", { name: "Download PDF" }).click(),
      ]);
      assert.equal(pdf.suggestedFilename(), `${PROJECT} results.pdf`);
      const bytes = readFileSync(await pdf.path());
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
