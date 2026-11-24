import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A new user schedules a Coworker Task for late today, and Home lists it
// under "Going out today" with its time and status, linking to the Task and
// to the Calendar on today's week. Each size signs up its own disposable
// mail.tm inbox. The Task is cancelled before it ends, so it never runs and
// spends nothing.
//
// The browser runs in a fixed-offset zone where it is still before 20:00, so
// 23:30 is always later today wherever the run happens.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const BOT = "Pip";
const BRIEF = "Draft the weekend opening hours post for the bakery";

const PROJECTS = [
  { name: "phone", width: 375, height: 812, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

/** A zone where the local hour is 06–19 now, and today's date there. */
function earlyZone(now = new Date()): { timezoneId: string; today: string } {
  for (let offset = -12; offset <= 14; offset++) {
    // `Etc/GMT+5` is UTC-5: the sign is inverted.
    const timezoneId =
      offset === 0
        ? "UTC"
        : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timezoneId,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(now),
    );
    if (hour >= 6 && hour < 20) {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezoneId,
      }).format(now);
      return { timezoneId, today };
    }
  }
  throw new Error("no zone has a daytime hour");
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
}

// Phone: the floating Create task button. Tablet: open the sidebar first.
async function openNewTask(page: Page) {
  const fab = page.getByRole("button", { name: "Create task" });
  const showSidebar = page.getByRole("button", { name: "Show sidebar" });
  const newTaskButton = page.getByRole("button", { name: "New task" });
  await fab.or(showSidebar).or(newTaskButton).first().waitFor();
  if (await fab.isVisible()) await fab.click();
  else {
    if (await showSidebar.isVisible()) await showSidebar.click();
    await newTaskButton.click();
  }
  return page.getByRole("dialog", { name: "New task" });
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
    test("Home lists a Task scheduled for later today", async () => {
      const { timezoneId, today } = earlyZone();
      const context = await browser.newContext({
        viewport,
        isMobile,
        hasTouch: isMobile,
        timezoneId,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}going-out-today-${size}-${step}.png`,
        });

      const mailbox = await createMailbox();
      await page.goto(`${BASE_URL}/signup`);
      const chip = page.getByRole("button", {
        name: `${mailbox.address} Change email`,
      });
      for (let attempt = 0; !(await chip.isVisible()); attempt++) {
        assert.ok(attempt < 3, "the email step never took the address");
        await page
          .getByRole("textbox", { name: "Email" })
          .fill(mailbox.address);
        await page.getByRole("button", { name: "Continue with email" }).click();
        await chip.waitFor({ timeout: 10_000 }).catch(() => {});
      }
      await page.getByRole("textbox", { name: "First name" }).fill("E2E");
      await page.getByRole("textbox", { name: "Last name" }).fill("Tester");
      await page
        .getByRole("textbox", { name: "Code from the email" })
        .pressSequentially(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();
      await page.waitForURL(/\/setup$/);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForURL(/\/setup\/assistant$/);
      await page.getByRole("textbox", { name: "Name" }).fill(BOT);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: `Create ${BOT}` }).click();
      await page.waitForURL(/\/setup\/assistant\/connect$/);
      await page.getByRole("link", { name: "Skip" }).click();
      await page.waitForURL(/\/chat\/rooms\//);

      // Nothing goes out yet, so Home has no list.
      await page.goto(`${BASE_URL}/`);
      await page.getByRole("region", { name: "Needs you" }).waitFor();
      assert.equal(
        await page.getByRole("region", { name: "Going out today" }).count(),
        0,
      );

      // Phones open New task from the Tasks board, not from Home.
      await page.goto(`${BASE_URL}/tasks`);
      await page.getByRole("heading", { name: "Backlog" }).waitFor();
      const newTask = await openNewTask(page);
      await newTask.getByRole("button", { name: /^EL Elena/ }).click();
      await newTask.getByRole("button", { name: /Start from scratch/ }).click();
      await newTask.getByRole("textbox", { name: "Details" }).fill(BRIEF);
      // Scheduled before it is created: a Ready Task would start at once.
      await newTask.getByRole("button", { name: "Set start time" }).click();
      const startTime = page.getByRole("dialog", { name: "Start time" });
      await startTime.getByLabel("Start at").fill(`${today}T23:30`);
      await startTime.getByRole("button", { name: "Apply" }).click();
      await newTask.getByText(/^Starts .*11:30 PM$/).waitFor();
      let taskUrl: string | null = null;
      try {
        await newTask.getByRole("button", { name: "Schedule task" }).click();
        await newTask
          .getByRole("button", { name: "Bring me to the task" })
          .click({ timeout: 120_000 });
        await page.waitForURL(/\/tasks\//);
        taskUrl = page.url();
        const taskName = await page
          .getByRole("heading", { level: 1 })
          .innerText();

        await page.goto(`${BASE_URL}/`);
        const goingOut = page.getByRole("region", { name: "Going out today" });
        const row = goingOut.getByRole("link", {
          name: new RegExp(
            `^Scheduled task: ${RegExp.escape(taskName)}.*11:30\\sPM.*Scheduled$`,
          ),
        });
        await row.waitFor();
        await row.scrollIntoViewIfNeeded();
        await noSidewaysScroll(page);
        await shot("1-home");

        const seeAll = goingOut.getByRole("link", {
          name: "See all on Calendar",
        });
        const href = new URL(
          (await seeAll.getAttribute("href")) ?? "",
          BASE_URL,
        );
        assert.equal(href.pathname, "/calendar");
        assert.equal(href.searchParams.get("date"), today);
        assert.equal(href.searchParams.get("view"), "week");
        const box = await seeAll.boundingBox();
        assert.ok(box && box.height >= 24, "Calendar link under 24px tall");

        await row.click();
        await page.waitForURL(taskUrl);
        await page.getByRole("heading", { level: 1, name: taskName }).waitFor();
        await shot("2-task");
      } finally {
        // Never leave a Coworker Task scheduled to run.
        if (taskUrl) {
          await page.goto(taskUrl);
          await page.getByRole("combobox", { name: /^Status:/ }).click();
          await page.getByRole("option", { name: /^Canceled/ }).click();
          await page
            .getByRole("combobox", { name: "Status: Canceled" })
            .waitFor();
        }
      }

      assert.deepEqual(errors, []);
      await context.close();
    });
  });
}
