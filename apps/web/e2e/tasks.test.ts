import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";

// A new user's Task, end to end: create, rename to a long title, see its card on
// the board, archive, find it in Archived, restore. Each size signs up its own
// disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const MAIL_API = "https://api.mail.tm";

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];
const LONG_NAME =
  "Plan the November newsletter for the spring menu launch with a chef note";

async function mail(path: string, init: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  let response = await fetch(MAIL_API + path, { ...init, headers });
  // mail.tm rate-limits bursts; wait and try again.
  for (let i = 1; response.status === 429 && i <= 8; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000 * i));
    response = await fetch(MAIL_API + path, { ...init, headers });
  }
  assert.ok(response.ok, `mail.tm ${path}: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function createInbox() {
  const domains = await mail("/domains");
  const domain = domains["hydra:member"].find(
    (d: { isActive: boolean }) => d.isActive,
  ).domain;
  const address = `soko-e2e-${randomBytes(4).toString("hex")}@${domain}`;
  const password = randomBytes(18).toString("base64url");
  const body = JSON.stringify({ address, password });
  await mail("/accounts", { method: "POST", body });
  const { token } = await mail("/token", { method: "POST", body });
  return { address, token: token as string };
}

async function readCode(token: string) {
  for (let i = 0; i < 40; i++) {
    const list = await mail("/messages", {}, token);
    for (const { id } of list["hydra:member"]) {
      const message = await mail(`/messages/${id}`, {}, token);
      const code = `${message.subject} ${message.text}`.match(/\b\d{6}\b/);
      if (code) return code[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("no sign-up code arrived");
}

async function shot(page: Page, size: string, step: string) {
  await page.screenshot({ path: `${RESULTS_DIR}tasks-${size}-${step}.png` });
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
    test("a new user creates, renames, archives and restores a Task", async () => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      const inbox = await createInbox();
      await page.goto(`${BASE_URL}/signup`);
      await page.getByLabel("Email").fill(inbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByLabel("First name").fill("E2E");
      await page.getByLabel("Last name").fill("Tester");
      await page
        .getByLabel("Code from the email")
        .fill(await readCode(inbox.token));
      await page.getByRole("button", { name: "Register" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("link", { name: "Later" }).click();
      await page.waitForURL(`${BASE_URL}/`);

      await page.goto(`${BASE_URL}/tasks`);
      await page.getByRole("heading", { name: "Backlog" }).waitFor();
      // Phone: the floating Create task button. Tablet: open the sidebar first.
      const fab = page.getByRole("button", { name: "Create task" });
      const showSidebar = page.getByRole("button", { name: "Show sidebar" });
      const newTaskButton = page.getByRole("button", { name: "New task" });
      await fab.or(showSidebar).or(newTaskButton).first().waitFor();
      if (await fab.isVisible()) await fab.click();
      else {
        if (await showSidebar.isVisible()) await showSidebar.click();
        await newTaskButton.click();
      }
      const newTask = page.getByRole("dialog", { name: "New task" });
      await newTask.getByRole("button", { name: /E2E Tester/ }).click();
      await newTask.getByRole("button", { name: /Start from scratch/ }).click();
      await newTask
        .getByRole("textbox", { name: "Details" })
        .fill("Three sections, one recipe teaser and a short chef note.");
      await newTask.getByRole("button", { name: "Create task" }).click();
      await newTask
        .getByRole("button", { name: "Bring me to the task" })
        .click({ timeout: 120_000 });

      const participants = page.getByRole("button", {
        name: /^Participants:/,
      });
      const participantsBox = await participants.boundingBox();
      assert.ok(
        participantsBox && participantsBox.height >= 24,
        `Participants is ${participantsBox?.height}px tall`,
      );
      await shot(page, size, "1-task");

      await page.getByRole("button", { name: "Actions" }).click();
      await page.getByRole("menuitem", { name: "Edit" }).click();
      const nameField = page.getByRole("textbox", { name: "Task name" });
      await nameField.fill(LONG_NAME);
      const clipped = await nameField.evaluate(
        (el) => el.scrollWidth > el.clientWidth + 1,
      );
      assert.equal(clipped, false, "the title field cuts the name off");
      await shot(page, size, "2-edit");
      await page
        .getByRole("dialog", { name: "Edit task" })
        .getByRole("button", { name: "Save" })
        .click();
      await page.getByRole("heading", { level: 1, name: LONG_NAME }).waitFor();

      // Back on the board: a card without tags has no empty tags line. Only
      // cards count: the task page stays in the DOM, hidden, and its Auto
      // tags section can say "No tags yet".
      await page
        .getByRole("link", { name: "Back to tasks" })
        .or(page.getByRole("link", { name: "Back", exact: true }))
        .filter({ visible: true })
        .click();
      const card = page.getByRole("link", { name: LONG_NAME });
      await card.waitFor();
      assert.equal(
        await page.locator("article").getByText("No tags yet").count(),
        0,
        "a board card shows an empty tags line",
      );
      await card.click();

      await page.getByRole("button", { name: "Archive", exact: true }).click();
      await page.waitForURL(`${BASE_URL}/tasks`);
      await page.getByRole("link", { name: "Archived tasks" }).click();
      const row = page.getByRole("link", { name: LONG_NAME });
      await row.waitFor();
      const nameStyle = await row
        .locator("span")
        .last()
        .evaluate((el) => {
          const style = getComputedStyle(el);
          return `${style.whiteSpace} ${style.textOverflow}`;
        });
      assert.ok(
        !nameStyle.includes("nowrap"),
        `archived name does not wrap (${nameStyle})`,
      );
      await shot(page, size, "3-archived");

      await page.getByRole("button", { name: `Restore ${LONG_NAME}` }).click();
      await page.getByText("is back on the board").waitFor();

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
