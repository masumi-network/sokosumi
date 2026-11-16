import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user's project slips a week: they move every open due date in it at
// once from the project menu. Each size signs up a new throwaway user, sets
// up at desktop width, then uses the feature at its own size. Nothing is
// paid for: the Tasks are assigned to the user, not to an agent.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];
const TASKS = [
  { details: "Draft the launch announcement post", due: "2030-03-02" },
  { details: "Send the launch newsletter", due: "2030-03-09" },
];

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
});
after(() => browser.close());

async function signUp(page: Page, lastName: string) {
  const mailbox = await createMailbox();
  await page.goto(`${BASE_URL}/`);
  await page.getByRole("link", { name: "Register" }).click();
  // Sign-in has an Email field too; wait until sign-up has replaced it.
  await page.waitForURL(/\/signup/);
  await page.getByRole("heading", { name: "Create your account" }).waitFor();
  await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page
    .getByRole("button", { name: `${mailbox.address} Change email` })
    .waitFor();
  await page.getByRole("textbox", { name: "First name" }).fill("Ada");
  await page.getByRole("textbox", { name: "Last name" }).fill(lastName);
  await page
    .getByRole("textbox", { name: "Code from the email" })
    .pressSequentially(await mailbox.nextCode());
  await page.getByRole("button", { name: "Register" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("link", { name: "Later" }).click();
  await page.waitForURL(`${BASE_URL}/`);
}

async function createProject(page: Page) {
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "New project" }).click();
  await page
    .getByRole("textbox", { name: "Project name" })
    .fill("Spring launch");
  await page.getByRole("button", { name: "Continue" }).click();
  await page
    .getByRole("textbox", { name: "Briefing" })
    .fill("Launch of our spring collection.");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  await page
    .getByRole("heading", { name: "Spring launch", level: 1 })
    .waitFor();
}

async function createDatedTask(page: Page, details: string, due: string) {
  const dialog = page.getByRole("dialog", { name: "New task" });
  // A click before the page hydrates opens nothing; try again until it does.
  for (let attempt = 0; attempt < 3 && !(await dialog.isVisible()); attempt++) {
    await page.getByRole("button", { name: "New task" }).click();
    await dialog.waitFor({ timeout: 10_000 }).catch(() => {});
  }
  await dialog.getByRole("button", { name: /\bAda\b/ }).click();
  await dialog.getByRole("button", { name: /Start from scratch/ }).click();
  await dialog.getByRole("textbox", { name: "Details" }).fill(details);
  await dialog.getByRole("button", { name: "Create task" }).click();
  await dialog.getByRole("button", { name: "Bring me to the task" }).click();
  await page.waitForURL(/\/tasks\//);
  await page.getByRole("button", { name: "No due date" }).click();
  await page.getByLabel("Due date").fill(due);
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: /^Due / }).waitFor();
  await page.getByRole("link", { name: "Spring launch" }).first().click();
  await page
    .getByRole("heading", { name: "Spring launch", level: 1 })
    .waitFor();
}

async function openMoveDates(page: Page) {
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Move due dates…" }).click();
  return page.getByRole("dialog", { name: "Move due dates" });
}

for (const { name, ...viewport } of PROJECTS) {
  describe(name, () => {
    test("a new user moves every due date in a project a week later", async () => {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      try {
        await run(page, name, viewport);
      } catch (error) {
        await page.screenshot({
          path: `${RESULTS_DIR}move-dates-${name}-failure.png`,
        });
        throw error;
      }
      await context.close();
      assert.deepEqual(errors, []);
    });
  });
}

async function run(
  page: Page,
  name: string,
  viewport: { width: number; height: number },
) {
  await signUp(page, name);
  await createProject(page);
  for (const { details, due } of TASKS) {
    await createDatedTask(page, details, due);
  }

  await page.setViewportSize(viewport);
  const dialog = await openMoveDates(page);
  await dialog.getByText("2 Tasks move").waitFor();
  await dialog.getByText("Mar 16").waitFor();
  const overflow = await dialog.evaluate((box) => {
    const right = box.getBoundingClientRect().right;
    return [...box.querySelectorAll("*")].filter(
      (el) => el.getBoundingClientRect().right > right + 1,
    ).length;
  });
  // Every Task name is readable in full: none is cut off to fit its row.
  const clippedNames = await dialog.getByRole("listitem").evaluateAll(
    (rows) =>
      rows.filter((row) => {
        const name = row.firstElementChild;
        return !name || name.scrollWidth > name.clientWidth + 1;
      }).length,
  );
  await page.screenshot({
    path: `${RESULTS_DIR}move-dates-${name}-preview.png`,
  });
  await dialog.getByRole("button", { name: "Move 2 Tasks" }).click();
  await page.getByText("Moved 2 due dates").waitFor();

  // Opening it again shows the days the move set.
  const again = await openMoveDates(page);
  await again.getByText("Mar 23").waitFor();
  const firstFrom = await again.getByText("Mar 9").count();
  await page.screenshot({
    path: `${RESULTS_DIR}move-dates-${name}-after.png`,
  });
  await again.getByRole("button", { name: "Cancel" }).click();

  assert.equal(overflow, 0, "nothing sticks out of the dialog");
  assert.equal(clippedNames, 0, "no Task name is cut off");
  assert.ok(firstFrom > 0, "the first Task now starts from Mar 9");
}
