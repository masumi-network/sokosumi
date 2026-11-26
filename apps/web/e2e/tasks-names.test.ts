import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user's Task uses the board's words everywhere: the status picker finds
// Completed by the Done column, and the user's initials read the same on the
// task page, the board card and the Filters coworker list.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];
const TASK = "Draft the spring newsletter intro";

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  console.log(`E2E_BASE_URL=${BASE_URL}`);
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name: size, ...viewport } of PROJECTS) {
  describe(size, () => {
    test("the status picker finds Done, and initials read EN on three surfaces", async () => {
      const mailbox = await createMailbox();
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}tasks-names-${size}-${step}.png`,
        });

      await page.goto(`${BASE_URL}/signup`);
      await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByRole("textbox", { name: "First name" }).fill("E2E");
      await page.getByRole("textbox", { name: "Last name" }).fill("Names");
      await page
        .getByRole("textbox", { name: "Code from the email" })
        .pressSequentially(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("link", { name: "Later" }).click();
      await page.waitForURL(`${BASE_URL}/`);

      // Create a Task for yourself.
      await page.goto(`${BASE_URL}/tasks`);
      // A tablet keeps New task in the closed sidebar.
      const newTask = page
        .getByRole("button", { name: "New task" })
        .filter({ visible: true });
      const showSidebar = page.getByRole("button", { name: "Show sidebar" });
      await newTask.or(showSidebar).first().waitFor();
      if ((await newTask.count()) === 0) await showSidebar.click();
      await newTask.first().click();
      const dialog = page.getByRole("dialog", { name: "New task" });
      await dialog.getByRole("textbox", { name: "Task name" }).fill(TASK);
      await dialog.getByRole("combobox", { name: /^Assignee:/ }).click();
      await page.keyboard.type("E2E Names");
      await page.getByRole("option", { name: /E2E Names/ }).click();
      await dialog
        .getByRole("combobox", { name: "Assignee: E2E Names" })
        .waitFor();
      await dialog.getByRole("button", { name: "Create task" }).click();
      await dialog
        .getByRole("button", { name: "Bring me to the task" })
        .click();
      await page.getByRole("heading", { level: 1, name: TASK }).waitFor();

      // The task page shows both initials, EN.
      const assignee = page
        .getByRole("combobox", { name: /^Assignee:/ })
        .filter({ visible: true });
      assert.match((await assignee.textContent()) ?? "", /^EN/);

      // The status picker finds a status by its board column.
      await page.getByRole("combobox", { name: /^Status:/ }).click();
      await page.getByPlaceholder("Change status…").fill("Done");
      await page
        .getByRole("option", { name: /^Draft/ })
        .waitFor({ state: "detached" });
      await shot("1-status-done");
      await page.getByRole("option", { name: /^Completed/ }).click();
      await page.getByText("Task status updated").waitFor();

      // The board card and the Filters coworker list show EN too.
      await page.goto(`${BASE_URL}/tasks`);
      const done = page.getByRole("region", { name: "Done" });
      await done.getByRole("link", { name: TASK }).waitFor();
      assert.equal(
        (
          await done.getByRole("img", { name: "E2E Names" }).textContent()
        )?.trim(),
        "EN",
      );
      await page.getByRole("button", { name: "Filters" }).click();
      await page
        .getByRole("button", { name: /^Coworker/ })
        .or(page.getByRole("menuitem", { name: /^Coworker/ }))
        .first()
        .click();
      const option = page.getByRole("option", { name: /E2E Names/ });
      assert.match((await option.textContent()) ?? "", /EN/);
      await shot("2-filters-coworker");

      await context.close();
      assert.deepEqual(errors, []);
    });
  });
}
