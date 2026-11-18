import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";

// A new user's Task, end to end: create, rename to a long title, see its card on
// the board, archive, find it in Archived, restore. Each size signs up its own
// disposable mail.tm inbox. Screen reader checks ride along: the task page is
// titled with the task's name, closed dialogs leave no headings behind, and a
// board card is a link, not a nameless "draggable" button.
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
      const title = await page.getByRole("heading", { level: 1 }).innerText();
      await page.waitForFunction(
        (name) => document.title.includes(name),
        title,
      );
      for (const leaked of ["...", "Search"]) {
        assert.equal(
          await page
            .getByRole("heading", { name: leaked, exact: true })
            .count(),
          0,
          `a closed dialog leaves the heading "${leaked}" on the page`,
        );
      }
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
      // Keyboard order: the next Tab stop after the toolbar's Archived link is
      // the card's task link, with no extra stop on the card around it.
      await page
        .getByRole("link", { name: "Archived tasks" })
        .filter({ visible: true })
        .focus();
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement?.textContent),
        LONG_NAME,
        "Tab after Archived does not land on the card's task link",
      );
      // Enter opens the task and moves focus to its heading, visibly, so a
      // screen reader reads the name even when the streamed tab title is late.
      await page.keyboard.press("Enter");
      await page.waitForFunction((name) => {
        const el = document.activeElement;
        return (
          el?.tagName === "H1" &&
          el.textContent === name &&
          el.matches(":focus-visible")
        );
      }, LONG_NAME);

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

      // Search says what it found in one polite status line that stays the
      // same element across searches (a fresh one is often not read), and
      // focus stays in the search box.
      const search = page.getByRole("searchbox", {
        name: "Search archived tasks",
      });
      const status = await page
        .locator('main p[role="status"]')
        .elementHandle();
      assert.ok(status, "no status line before the first search");
      assert.equal(await status.textContent(), "");
      const searchFor = async (query: string, said: string) => {
        await search.fill(query);
        await search.press("Enter");
        await page.waitForFunction(
          ([el, text]) => el.isConnected && el.textContent === text,
          [status, said] as const,
        );
        assert.equal(
          await search.evaluate((el) => el === document.activeElement),
          true,
          `search box loses focus after searching "${query}"`,
        );
      };
      await searchFor(LONG_NAME, `1 archived task matches “${LONG_NAME}”.`);
      await row.waitFor();
      await shot(page, size, "4-archived-search");
      await searchFor(
        "zz-no-such-task",
        "No archived tasks match “zz-no-such-task”.",
      );
      await searchFor("", "");
      await row.waitFor();

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
