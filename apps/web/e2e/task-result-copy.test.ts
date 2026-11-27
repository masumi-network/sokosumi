import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl, resolvePreviewCoreUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user drafts a Task for themself, completes it with a result through
// Core (their own API key, no credits: a person cannot set credits), then
// presses Copy under the result. The clipboard holds the rendered HTML, with
// its heading, link, list and table, and the Markdown as plain text. The key
// stays in memory, is never logged, and no screenshot is taken while it shows.
const BASE_URL = resolveBaseUrl(process.env);
// Anywhere but a PR preview the spec skips with the reason.
const CORE = (() => {
  try {
    return { url: resolvePreviewCoreUrl(BASE_URL), skip: false as const };
  } catch (error) {
    return { url: "", skip: (error as Error).message };
  }
})();
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const TASK_NAME = "Spring launch email plan";
const RESULT = `## Spring launch email plan

Send on **Tuesday 10 March**. Full brief in the [launch notes](https://example.com/spring-launch).

1. Teaser to the whole list
2. Launch email with the offer

| Email | Send date |
| --- | --- |
| Teaser | 3 March |
| Launch | 10 March |
`;

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  console.log(`E2E_BASE_URL=${BASE_URL}`);
  browser = await chromium.launch();
});
after(() => browser?.close());

async function createApiKey(page: Page) {
  await page.goto(`${BASE_URL}/developer/api-keys`);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create new API key" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("E2E result copy");
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

/** A Draft assigned to the user, so nothing runs and no credits are spent. */
async function draftOwnTask(page: Page, firstName: string) {
  // Its sidebar button is hidden at tablet width; the shortcut is not.
  await page.keyboard.press("Alt+N");
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByRole("combobox", { name: /^Assignee:/ }).click();
  await page.keyboard.type(firstName);
  await page.keyboard.press("Enter");
  await dialog
    .getByRole("combobox", { name: "Status: Draft" })
    .waitFor({ state: "attached" });
  await dialog.getByRole("textbox", { name: "Task name" }).fill(TASK_NAME);
  await dialog.getByRole("button", { name: "Create task" }).click();
  await dialog.getByRole("button", { name: "Bring me to the task" }).click();
  await page.waitForURL(/\/tasks\/[^/?]+$/);
  return new URL(page.url()).pathname.split("/").pop() as string;
}

for (const { name: size, ...viewport } of PROJECTS) {
  describe(size, () => {
    test("Copy puts the result on the clipboard with its formatting", {
      skip: CORE.skip,
    }, async () => {
      const mailbox = await createMailbox();
      const context = await browser.newContext({ viewport });
      await context.grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: BASE_URL,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await page.goto(`${BASE_URL}/signup`);
      await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByRole("textbox", { name: "First name" }).fill("Copier");
      await page.getByRole("textbox", { name: "Last name" }).fill("E2E");
      await page
        .getByRole("textbox", { name: "Code from the email" })
        .pressSequentially(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("link", { name: "Later" }).click();
      await page.waitForURL(`${BASE_URL}/`);

      const key = await createApiKey(page);
      const taskId = await draftOwnTask(page, "Copier");

      // Native fetch, no redirects: the key goes only to the paired Core.
      const done = await fetch(`${CORE.url}/v1/tasks/${taskId}/events`, {
        method: "POST",
        redirect: "manual",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "COMPLETED", comment: RESULT }),
      });
      assert.ok(done.ok, `completing the Task failed: ${done.status}`);
      assert.equal((await done.json()).data.transactionId, null, "charged");

      await page.reload();
      const copy = page
        .getByRole("button", { name: "Copy", exact: true })
        .filter({ visible: true });
      await copy.scrollIntoViewIfNeeded();
      await copy.click();
      await page.getByText("Result copied with formatting").waitFor();
      await page.screenshot({
        path: `${RESULTS_DIR}task-result-copy-${size}.png`,
      });

      const clipboard = await page.evaluate(async () => {
        const [item] = await navigator.clipboard.read();
        const text = async (type: string) => (await item.getType(type)).text();
        return {
          html: await text("text/html"),
          plain: await text("text/plain"),
        };
      });
      assert.match(clipboard.html, /<h2>Spring launch email plan<\/h2>/);
      assert.match(clipboard.html, /<strong>Tuesday 10 March<\/strong>/);
      assert.match(
        clipboard.html,
        /<a href="https:\/\/example\.com\/spring-launch">launch notes<\/a>/,
      );
      assert.match(clipboard.html, /<ol>[\s\S]*<li>Teaser to the whole list/);
      assert.match(clipboard.html, /<table>[\s\S]*<td>3 March<\/td>/);
      assert.equal(clipboard.plain, RESULT);

      assert.deepEqual(errors, [], "page errors");
      await context.close();
    });
  });
}
