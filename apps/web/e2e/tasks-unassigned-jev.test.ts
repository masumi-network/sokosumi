import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Locator, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user writes a Task. New task keeps every property and the tag Jev
// adds in view, wrapped, with "Added by Jev" announced under them. The user
// leaves it unassigned (a Draft, so nothing runs or costs credits), and the
// board card and the task page both say "Unassigned" with the picker's person
// outline. Each size signs up its own disposable mail.tm inbox.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const TASK = "Plan the Saturday tasting flyer";
const BRIEF =
  "Write the copy for a printed flyer announcing the Saturday wine and cheese tasting event at the café, with date, time and price.";

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

// Every property sits inside the dialog; none hides past its edge.
async function allInside(row: Locator, dialog: Locator) {
  const box = await dialog.boundingBox();
  assert.ok(box, "New task has no box");
  const outside = await row.evaluate(
    (element, edge) =>
      [...element.querySelectorAll("button, [data-slot=badge]")]
        .map((child) => child.getBoundingClientRect())
        .filter(
          (rect) =>
            rect.width > 0 &&
            (rect.left < edge.left - 1 || rect.right > edge.right + 1),
        ).length + (element.scrollWidth > element.clientWidth + 1 ? 1 : 0),
    { left: box.x, right: box.x + box.width },
  );
  assert.equal(outside, 0, "a property hides past the dialog edge");
}

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  console.log(`E2E_BASE_URL=${BASE_URL}`);
  browser = await chromium.launch();
});
after(() => browser.close());

for (const { name: size, isMobile, ...viewport } of PROJECTS) {
  describe(size, () => {
    test("New task wraps with Jev's tag in view, and an unassigned Task reads Unassigned", async () => {
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}tasks-unassigned-jev-${size}-${step}.png`,
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

      await page.goto(`${BASE_URL}/tasks`);
      await page.getByRole("heading", { name: "Backlog" }).waitFor();

      // Phone: the floating Create task button. Tablet: open the sidebar first.
      const fab = page.getByRole("button", { name: "Create task" });
      const showSidebar = page.getByRole("button", { name: "Show sidebar" });
      const newTaskButton = page.getByRole("button", { name: "New task" });
      await fab.or(showSidebar).or(newTaskButton).first().waitFor();
      // The tablet sidebar overlays the board, so close it again after.
      let openedSidebar = false;
      if (await fab.isVisible()) await fab.click();
      else {
        if (await showSidebar.isVisible()) {
          await showSidebar.click();
          openedSidebar = true;
        }
        await newTaskButton.click();
      }
      const dialog = page.getByRole("dialog", { name: "New task" });
      await dialog.getByRole("textbox", { name: "Task name" }).fill(TASK);
      await dialog.getByRole("textbox", { name: "Details" }).fill(BRIEF);

      // Jev adds a tag; the line under the properties says so, out loud.
      const row = dialog.getByRole("group", { name: "Task properties" });
      await row.getByRole("img", { name: "Added by Jev" }).first().waitFor();
      await dialog
        .getByRole("status")
        .filter({ hasText: "Added by Jev" })
        .waitFor();
      await allInside(row, dialog);
      await noSidewaysScroll(page);
      await shot("1-new-task-jev-tag");

      // Nobody assigned: the picker's outline and word. Draft, so nothing runs.
      await dialog.getByRole("combobox", { name: /^Assignee:/ }).click();
      await page.keyboard.type("Unassigned");
      await page.getByRole("option", { name: "Unassigned" }).click();
      await dialog
        .getByRole("combobox", { name: "Assignee: Unassigned" })
        .waitFor();
      await dialog.getByRole("combobox", { name: "Status: Draft" }).waitFor();
      await allInside(row, dialog);
      await dialog.getByRole("button", { name: "Create task" }).click();
      await dialog.getByRole("heading", { name: "Task created" }).waitFor();
      await dialog.getByRole("button", { name: "Close" }).click();
      if (openedSidebar) {
        await page.getByRole("button", { name: "Hide sidebar" }).click();
        // Shoot only once the sidebar has finished sliding away. Bounded by
        // the default timeout; transitions only, the presence pulse never ends.
        await page.waitForFunction(() => {
          const el = document.querySelector(
            '[data-slot="sidebar"][data-state="collapsed"]',
          );
          return (
            el !== null &&
            !el
              .getAnimations({ subtree: true })
              .some(
                (a) => a instanceof CSSTransition && a.playState === "running",
              )
          );
        });
      }

      // The board card names it Unassigned, with an outline, not "?".
      const backlog = page.getByRole("region", { name: "Backlog" });
      // A trial click fails while anything still covers the card.
      await backlog.getByRole("link", { name: TASK }).click({ trial: true });
      const nobody = backlog.getByRole("img", { name: "Unassigned" });
      assert.equal(await nobody.locator("svg").count(), 1);
      assert.equal((await nobody.textContent())?.trim(), "");
      await noSidewaysScroll(page);
      await shot("2-board-card-unassigned");

      // The task page says the same.
      await backlog.getByRole("link", { name: TASK }).click();
      await page.getByRole("heading", { level: 1, name: TASK }).waitFor();
      await page
        .getByRole("combobox", { name: "Assignee: Unassigned" })
        .filter({ visible: true })
        .waitFor();
      await noSidewaysScroll(page);
      await shot("3-task-page-unassigned");

      await context.close();
      assert.deepEqual(errors, []);
    });
  });
}
