import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page, type Route } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";

// A new user's Task, end to end: create, rename to a long title, reopen Edit
// after Save and after Cancel, see its card on the board, archive, find it in Archived, restore. Each size signs up its own
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

const PREFETCH_HEADERS = [
  "next-router-prefetch",
  "next-router-segment-prefetch",
];

function isPrefetch(headers: Record<string, string>) {
  return PREFETCH_HEADERS.some((name) => name in headers);
}

/**
 * Paths whose page shell the app has prefetched in this page, as links come
 * into view. Partial Prefetching asks for the shell with
 * `next-router-prefetch: 2` or `3` and the route tree alone with a
 * `next-router-segment-prefetch: /_tree` request; only the first counts, and
 * only once its whole body arrived with a success or not-modified status. The shell is the
 * same for every search of a route, so the path is the key.
 */
const prefetchedPaths = new WeakMap<Page, Set<string>>();

function trackPrefetches(page: Page) {
  const paths = new Set<string>();
  prefetchedPaths.set(page, paths);
  page.on("requestfinished", async (request) => {
    const headers = request.headers();
    if (!["2", "3"].includes(headers["next-router-prefetch"] ?? "")) return;
    if (headers["next-router-segment-prefetch"] === "/_tree") return;
    // 304: the browser revalidated the shell it already holds.
    const status = (await request.response())?.status() ?? 0;
    if ((status >= 200 && status < 300) || status === 304) {
      paths.add(new URL(request.url()).pathname);
    }
  });
}

/**
 * What a loading frame shows: for each named selector, the text of its first
 * visible match in `main`, or null when none is visible.
 */
type ShellChecks = Record<string, string>;

/**
 * Runs in the page: records the first frame `shell` is visible, with
 * `checks`, and every frame that differs while it stays visible.
 */
function recordShellFrame({
  shell,
  checks,
}: {
  shell: string;
  checks: ShellChecks;
}) {
  type Frame = {
    top: number;
    href: string;
    seen: Record<string, string | null>;
    /** Chip labels cut short by their own box, not just scrolled away. */
    clippedLabels: string[];
  };
  const record = window as unknown as {
    __shellFrame?: Frame;
    __shellFrames?: Frame[];
  };
  delete record.__shellFrame;
  record.__shellFrames = [];
  let last = "";
  const visible = (selector: string) =>
    Array.from(document.querySelectorAll(`main ${selector}`)).find((el) =>
      el.checkVisibility(),
    );
  const started = performance.now();
  const tick = () => {
    const frame = visible(shell);
    if (frame) {
      const entry: Frame = {
        clippedLabels: Array.from(
          document.querySelectorAll("main ul[aria-label] li span[title]"),
        )
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => el.textContent ?? ""),
        top: Math.round(frame.getBoundingClientRect().top),
        href: location.href,
        seen: Object.fromEntries(
          Object.entries(checks).map(([name, selector]) => {
            const el = visible(selector);
            // What a reader sees: a field's placeholder, else the text,
            // else the name of an icon-only control.
            const seen = !el
              ? null
              : el instanceof HTMLInputElement
                ? el.placeholder
                : el.textContent?.trim() || el.getAttribute("aria-label") || "";
            return [name, seen];
          }),
        ),
      };
      record.__shellFrame ??= entry;
      const key = JSON.stringify(entry);
      if (key !== last) record.__shellFrames?.push(entry);
      last = key;
    } else if (record.__shellFrame) {
      return;
    }
    if (performance.now() - started < 60_000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function readShellFrame(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __shellFrame?: {
            top: number;
            href: string;
            seen: Record<string, string | null>;
          };
        }
      ).__shellFrame,
  );
}

/**
 * Holds the server's answer for one page's content while `navigate` runs, so
 * its loading shell stays on screen. Only the navigation's own request is
 * held, and only once the app has prefetched the page's shell: a held cold
 * request would hold back the shell itself. Records where `shellSelector`
 * first paints, waits until the page has loaded, and returns both tops: what
 * loads must open where its shell stood.
 */
async function measureShellToPage(
  page: Page,
  options: {
    pathname: string;
    navigate: () => Promise<unknown>;
    shellSelector: string;
    loadedSelector: string;
    shellChecks?: ShellChecks;
  },
) {
  const prefetched = prefetchedPaths.get(page);
  for (let i = 0; i < 30 && !prefetched?.has(options.pathname); i++) {
    await page.waitForTimeout(500);
  }
  assert.ok(
    prefetched?.has(options.pathname),
    `the app never prefetched the shell of ${options.pathname}`,
  );
  const holdContent = async (route: Route) => {
    if (!isPrefetch(route.request().headers())) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    await route.fallback();
  };
  const isHeld = (url: URL) =>
    url.pathname === options.pathname && url.searchParams.has("_rsc");
  await page.route(isHeld, holdContent);
  try {
    await page.evaluate(recordShellFrame, {
      shell: options.shellSelector,
      checks: options.shellChecks ?? {},
    });
    await options.navigate();
    // The target page itself, not the page we left: it can stay on screen
    // while the held answer is pending.
    await page
      .waitForFunction(
        ({ pathname, selector }) =>
          location.pathname === pathname && !!document.querySelector(selector),
        { pathname: options.pathname, selector: options.loadedSelector },
        { timeout: 60_000 },
      )
      .catch(async (error: unknown) => {
        const name = options.pathname.replaceAll("/", "_");
        await page.screenshot({
          path: `${RESULTS_DIR}never-loaded${name}.png`,
        });
        console.log(
          `never loaded ${options.pathname}: at ${page.url()}`,
          (await page.locator("main").first().innerText()).slice(0, 600),
        );
        throw error;
      });
  } finally {
    await page.unroute(isHeld, holdContent);
  }
  const frame = await readShellFrame(page);
  const loadedTop = await page.evaluate((selector) => {
    const loaded = Array.from(document.querySelectorAll(selector)).find((el) =>
      el.checkVisibility(),
    );
    return loaded ? Math.round(loaded.getBoundingClientRect().top) : 0;
  }, options.loadedSelector);
  return { shellTop: frame?.top, loadedTop, frame };
}

/** The toolbar controls every board shell frame must already show. */
const TOOLBAR_CHECKS: ShellChecks = {
  views: '[role="radiogroup"]',
  search: 'input[type="search"]',
  filters: "[data-filters-menu] button",
  viewOptions: 'button[aria-label="View options"]',
};

function assertToolbarInFrame(seen: Record<string, string | null> = {}) {
  for (const name of Object.keys(TOOLBAR_CHECKS)) {
    assert.ok(seen[name] != null, `the loading toolbar has no ${name}`);
  }
}

/** The board opens where its loading shell drew the columns. */
async function assertBoardLoadsInPlace(
  page: Page,
  navigate: () => Promise<unknown>,
) {
  const { shellTop, loadedTop, frame } = await measureShellToPage(page, {
    pathname: "/tasks",
    navigate,
    shellSelector: 'section:has([data-testid="task-card-skeleton"])',
    loadedSelector:
      'main [data-column-id="backlog"]:not(:has([data-testid="task-card-skeleton"]))',
    shellChecks: TOOLBAR_CHECKS,
  });
  assert.ok(shellTop, "the loading shell never painted a column");
  assertToolbarInFrame(frame?.seen);
  assert.ok(loadedTop > 0, "the loaded board has no column");
  assert.equal(
    loadedTop,
    shellTop,
    `the board's columns move while it loads (top ${shellTop} -> ${loadedTop}px)`,
  );
}

/**
 * Opens `path` by its URL on a slow connection, so the streamed loading
 * shell paints before the board: the first frame with a placeholder column
 * must already show the toolbar and `chip`, and the loaded columns must open
 * where it drew them. The app's own files are cached by then; only the page
 * itself arrives slowly.
 */
async function assertColdBoardShell(page: Page, path: string, chip: string) {
  // From the first frame of the new document; later documents in this page
  // record again, which is harmless.
  await page.addInitScript(
    `(${recordShellFrame})(${JSON.stringify({
      shell: 'section:has([data-testid="task-card-skeleton"])',
      checks: { ...TOOLBAR_CHECKS, chips: 'ul[aria-label="Active filters"]' },
    })})`,
  );
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: 96 * 1024,
    uploadThroughput: 96 * 1024,
  });
  try {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: "commit" });
    await page.waitForFunction(
      () =>
        Array.from(
          document.querySelectorAll('main [data-column-id="backlog"]'),
        ).some(
          (el) =>
            el.checkVisibility() &&
            !el.querySelector('[data-testid="task-card-skeleton"]'),
        ),
      undefined,
      { timeout: 90_000 },
    );
  } finally {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await cdp.detach();
  }
  const frame = await readShellFrame(page);
  const frames = await page.evaluate(
    () =>
      (window as unknown as { __shellFrames?: unknown[] }).__shellFrames ?? [],
  );
  console.log(`${path} loading frames:`, JSON.stringify(frames));
  assert.ok(frame, `${path} painted no loading shell before the board`);
  assert.equal(new URL(frame.href).pathname + new URL(frame.href).search, path);
  assertToolbarInFrame(frame.seen);
  for (const shown of frames as { clippedLabels?: string[] }[]) {
    assert.deepEqual(
      shown.clippedLabels ?? [],
      [],
      "a loading frame cuts a filter chip's label short",
    );
  }
  assert.ok(
    frame.seen.chips?.includes(chip),
    `the loading toolbar shows "${frame.seen.chips}", not the ${chip} chip`,
  );
  const loadedTop = await page.evaluate(() => {
    const column = Array.from(
      document.querySelectorAll('main [data-column-id="backlog"]'),
    ).find((el) => el.checkVisibility());
    return column ? Math.round(column.getBoundingClientRect().top) : 0;
  });
  assert.equal(
    loadedTop,
    frame.top,
    `the filtered board's columns move while it loads (top ${frame.top} -> ${loadedTop}px)`,
  );
  const clippedLoaded = await page.evaluate(() =>
    Array.from(document.querySelectorAll("main ul[aria-label] li span[title]"))
      .filter(
        (el) => el.checkVisibility() && el.scrollWidth > el.clientWidth + 1,
      )
      .map((el) => el.textContent),
  );
  assert.deepEqual(
    clippedLoaded,
    [],
    "the loaded board cuts a filter chip's label short",
  );
}

/**
 * Tasks in the sidebar, or the phone tab bar; the tablet opens the sidebar.
 * Shown before the click, so the app can prefetch the board's shell.
 */
async function showTasksLink(page: Page) {
  const tasksLink = page
    .getByRole("link", { name: "Tasks", exact: true })
    .filter({ visible: true });
  const showSidebar = page.getByRole("button", { name: "Show sidebar" });
  // Whichever the layout draws first; Home may still be rendering.
  await tasksLink.or(showSidebar).first().waitFor();
  // A closed sidebar keeps its link in the DOM, off screen to the left.
  const onScreen = async () => {
    for (const link of await tasksLink.all()) {
      const box = await link.boundingBox();
      if (box && box.x >= 0) return link;
    }
    return null;
  };
  let link = await onScreen();
  if (!link) {
    await showSidebar.click();
    for (let i = 0; i < 20 && !link; i++) {
      await page.waitForTimeout(100);
      link = await onScreen();
    }
  }
  assert.ok(link, "no Tasks link on screen");
  return link;
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
      trackPrefetches(page);

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

      await showTasksLink(page);
      // Shown again at the click: a tablet's sidebar can close meanwhile.
      await assertBoardLoadsInPlace(page, async () =>
        (await showTasksLink(page)).click(),
      );
      // From md up the loaded board fits the screen: the page itself does not
      // scroll. Measured with the sidebar closed: beside an open sidebar at
      // 768px the toolbar wraps to two rows, which this check does not cover.
      if (viewport.width >= 768) {
        const sidebarOpen = () =>
          page.evaluate(
            () =>
              (document
                .querySelector('[data-sidebar="sidebar"]')
                ?.getBoundingClientRect().left ?? -1) >= 0,
          );
        if (viewport.width < 1024 && (await sidebarOpen())) {
          // The sidebar's own shortcut; an open sidebar has no close button.
          await page.keyboard.press("Control+b");
          await page.waitForFunction(
            () =>
              (document
                .querySelector('[data-sidebar="sidebar"]')
                ?.getBoundingClientRect().left ?? -1) < 0,
          );
          await page.waitForTimeout(300);
        }
        const { pageScroll, mainWidth } = await page.evaluate(() => {
          const main = document.querySelector("main");
          return {
            pageScroll: main ? main.scrollHeight - main.clientHeight : -1,
            mainWidth: main?.clientWidth ?? 0,
          };
        });
        assert.equal(
          pageScroll,
          0,
          `the board page scrolls ${pageScroll}px (main ${mainWidth}px wide)`,
        );
      }
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
        // Asks for writing, so the free tag step reliably picks a topic.
        .fill(
          "Write three newsletter subject lines, one recipe teaser and a short chef note.",
        );
      await newTask.getByRole("button", { name: "Create task" }).click();
      const goToTask = newTask.getByRole("button", {
        name: "Bring me to the task",
      });
      await goToTask.waitFor({ timeout: 120_000 });
      // A new Task is a Draft: the dialog says it waits, not "ready to go".
      await newTask
        .getByText("Nothing starts until you set it to Ready.", {
          exact: false,
        })
        .waitFor();
      await goToTask.click();

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

      // The task's own Tags region (the Edit dialog has one too).
      const tagsRegion = page
        .getByRole("complementary")
        .getByRole("region", { name: "Tags" })
        .filter({ visible: true });
      const tagNames = () =>
        tagsRegion.locator("[data-slot=badge]").allInnerTexts();
      await tagsRegion.locator("[data-slot=badge]").first().waitFor();
      const tagsBefore = await tagNames();

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
      // A rename keeps the automatic tags, marked as being checked. Previews
      // never run the tag job, so the mark stays.
      await tagsRegion
        .getByRole("status")
        .getByText("Checking tags for the latest changes…")
        .waitFor();
      assert.deepEqual(
        await tagNames(),
        tagsBefore,
        "a rename drops the task's tags",
      );
      await shot(page, size, "2a-tags-checking");
      // Saving refreshes Properties; each row shows once, not once per refresh.
      const assigneeRows = page
        .getByRole("combobox", { name: /^Assignee:/ })
        .filter({ visible: true });
      await assigneeRows.first().waitFor();
      const assigneeCount = await assigneeRows.count();
      assert.equal(
        assigneeCount,
        1,
        `the Assignee row shows ${assigneeCount} times after Save`,
      );

      // Next keeps the closed edit route alive. Without a reload, Edit opens
      // with the name just saved, and an edit cancelled before does not come
      // back (a later Save would store it).
      const editDialog = page.getByRole("dialog", { name: "Edit task" });
      const openEdit = async () => {
        await page.getByRole("button", { name: "Actions" }).click();
        await page.getByRole("menuitem", { name: "Edit" }).click();
        await editDialog.waitFor();
      };
      await openEdit();
      assert.equal(
        await nameField.inputValue(),
        LONG_NAME,
        "Edit after Save does not show the saved name",
      );
      await nameField.fill(`${LONG_NAME} DISCARD`);
      await editDialog.getByRole("button", { name: "Cancel" }).click();
      await editDialog.waitFor({ state: "hidden" });
      await openEdit();
      assert.equal(
        await nameField.inputValue(),
        LONG_NAME,
        "Edit shows the edit that was cancelled",
      );
      await shot(page, size, "2b-edit-after-cancel");
      await editDialog.getByRole("button", { name: "Cancel" }).click();
      await editDialog.waitFor({ state: "hidden" });

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
      // Keyboard order follows the screen: after the toolbar's last control,
      // View options, come the shortcuts to columns past the board's edge, in
      // order, then the card's task link, with no extra stop on the card.
      // Each shortcut shows its focus ring inside the pill, where the row
      // cannot clip it.
      const shortcutButtons = page
        .getByRole("navigation", { name: "Columns past the edge" })
        .getByRole("button")
        .filter({ visible: true });
      const tabToCard = async () => {
        await page
          .getByRole("button", { name: "View options" })
          .filter({ visible: true })
          .focus();
        const shortcuts = await shortcutButtons.evaluateAll((buttons) =>
          buttons.map((button) => button.textContent),
        );
        for (const shortcut of shortcuts) {
          await page.keyboard.press("Tab");
          const focused = await page.evaluate(() => {
            const el = document.activeElement;
            const box = el?.getBoundingClientRect();
            const row = el
              ?.closest("nav")
              ?.parentElement?.getBoundingClientRect();
            return {
              text: el?.textContent,
              visible: !!el?.matches(":focus-visible"),
              shadow: el ? getComputedStyle(el).boxShadow : "",
              // The row scrolls sideways; the focused pill must sit inside it.
              inRow:
                !!box &&
                !!row &&
                box.left >= row.left - 1 &&
                box.right <= row.right + 1,
            };
          });
          assert.ok(
            focused.inRow,
            `the focused shortcut "${shortcut}" sits past the row's edge`,
          );
          assert.equal(focused.text, shortcut, "Tab skips a column shortcut");
          assert.ok(
            focused.visible && /inset/.test(focused.shadow),
            `the shortcut "${shortcut}" shows no inset focus ring (${focused.shadow})`,
          );
        }
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(() => document.activeElement?.textContent),
          LONG_NAME,
          "Tab after the column shortcuts does not land on the card's task link",
        );
        return shortcuts.length;
      };
      await shortcutButtons.first().waitFor();
      assert.ok(
        (await tabToCard()) > 0,
        "no column shortcuts on a board wider than the screen",
      );
      // A screen wide enough for every column has no shortcuts: View options
      // leads straight to the card.
      if (size === "desktop") {
        await page.setViewportSize({ width: 2560, height: viewport.height });
        await shortcutButtons.first().waitFor({ state: "detached" });
        assert.equal(await tabToCard(), 0, "shortcuts on a board that fits");
        await page.setViewportSize(viewport);
        await shortcutButtons.first().waitFor();
        await tabToCard();
      }
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
      // Archived tasks live in the view options menu.
      await page
        .getByRole("button", { name: "View options" })
        .filter({ visible: true })
        .click();
      // Archived draws its heading, search and loading status at once, with
      // row frames the rows fill in where they stood.
      const archived = await measureShellToPage(page, {
        pathname: "/tasks/archived",
        navigate: async () => {
          await page
            .getByRole("link", { name: "Archived", exact: true })
            .click();
          await page
            .getByRole("heading", { level: 1, name: "Archived tasks" })
            .waitFor({ timeout: 2000 });
        },
        shellSelector: "ul > li:has(.animate-pulse)",
        loadedSelector: "main ul > li:has(a)",
        shellChecks: {
          heading: "h1",
          search: 'input[type="search"]',
          status: '[role="status"]:not(:empty)',
        },
      });
      assert.ok(archived.shellTop, "Archived painted no row placeholders");
      assert.equal(archived.frame?.seen.heading, "Archived tasks");
      assert.ok(
        archived.frame?.seen.search != null,
        "Archived's loading frame has no search field",
      );
      assert.equal(
        archived.frame?.seen.status,
        "Loading archived tasks…",
        "Archived's loading frame does not say it is loading",
      );
      assert.equal(
        archived.loadedTop,
        archived.shellTop,
        `Archived rows move when they load (top ${archived.shellTop} -> ${archived.loadedTop}px)`,
      );
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
      // Archived's own line: the task page visited earlier stays mounted,
      // hidden, with its "Checking tags" status line.
      const status = await page
        .getByRole("heading", { level: 1, name: "Archived tasks" })
        .locator(
          'xpath=ancestor::*[.//p[@role="status"]][1]//p[@role="status"]',
        )
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

      // An archived Task draws its way back and says it is loading at once;
      // its frame opens where the placeholder frame stood.
      const detailHref = await page
        .getByRole("link", { name: LONG_NAME })
        .getAttribute("href");
      assert.ok(detailHref, "the archived row has no link");
      const detail = await measureShellToPage(page, {
        pathname: detailHref,
        navigate: () => page.getByRole("link", { name: LONG_NAME }).click(),
        shellSelector: '[aria-hidden="true"]:has(.animate-pulse)',
        loadedSelector: "main div:has(> div > header h1)",
        shellChecks: {
          back: 'a[href="/tasks/archived"]',
          status: '[role="status"]:not(:empty)',
        },
      });
      assert.ok(detail.shellTop, "the archived Task painted no loading frame");
      assert.equal(detail.frame?.seen.back, "Archived tasks");
      assert.equal(detail.frame?.seen.status, "Loading archived task…");
      assert.equal(
        detail.loadedTop,
        detail.shellTop,
        `the archived Task's frame moves when it loads (top ${detail.shellTop} -> ${detail.loadedTop}px)`,
      );
      await page
        .getByRole("link", { name: "Archived tasks" })
        .filter({ visible: true })
        .click();
      await page.getByRole("button", { name: `Restore ${LONG_NAME}` }).click();
      await page.getByText("is back on the board").waitFor();

      // A filtered board opened by its URL streams its loading shell first:
      // the toolbar, the Draft chip and the placeholder columns in one frame,
      // and the columns open where that frame drew them.
      await assertColdBoardShell(
        page,
        "/tasks?status=DRAFT&sort=priority",
        "Status: Draft",
      );
      // The filtered board fits the document width too.
      const filteredOverflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      assert.equal(
        filteredOverflow,
        0,
        `the filtered board overflows by ${filteredOverflow}px`,
      );

      // Done sits past the board's right edge at every size. Once the only
      // Task is Completed, the edge names Done with its count, and a click
      // scrolls the board there and moves focus to the column.
      // It starts on the Draft-filtered board above.
      await page.getByRole("link", { name: LONG_NAME }).click();
      await page.getByRole("combobox", { name: /^Status:/ }).click();
      // The picker finds a status by the board column it lands in.
      await page.getByPlaceholder("Change status…").fill("Done");
      await page
        .getByRole("option", { name: /^Draft/ })
        .waitFor({ state: "detached" });
      await page.getByRole("option", { name: /^Completed/ }).click();
      await page.getByRole("combobox", { name: "Status: Completed" }).waitFor();
      // The combobox updates at once; wait until the save lands before leaving.
      await page.getByText("Task status updated").waitFor();
      // Back returns to the Draft filter, which hides a Completed Task: open
      // the whole board.
      await page.goto(`${BASE_URL}/tasks`);
      const edge = page.getByRole("navigation", {
        name: "Columns past the edge",
      });
      // Named with its count for screen readers: "Done, 1 task".
      const donePill = edge.getByRole("button", { name: /^Done\W*1 task$/ });
      await donePill.waitFor();
      // The shortcuts own a row above the columns: they never cover a card or
      // take its taps, at any size.
      const navBox = await edge.boundingBox();
      const boardBox = await page
        .locator("main [data-board-scroller]")
        .filter({ visible: true })
        .boundingBox();
      assert.ok(navBox && boardBox, "no board or shortcut row");
      assert.ok(
        navBox.y + navBox.height <= boardBox.y,
        `the shortcuts overlap the board (${navBox.y + navBox.height} > ${boardBox.y})`,
      );
      await shot(page, size, "5-board-edge");
      await donePill.click();
      const doneColumn = page.getByRole("region", { name: "Done" });
      await page.waitForFunction(() => {
        const done = document.querySelector('main [data-column-id="done"]');
        const box = done?.getBoundingClientRect();
        return !!box && box.left >= 0 && box.right <= window.innerWidth + 1;
      });
      assert.equal(
        await doneColumn.evaluate((el) => el === document.activeElement),
        true,
        "focus does not move to Done",
      );
      await doneColumn.getByRole("link", { name: LONG_NAME }).waitFor();
      await edge.waitFor({ state: "hidden" });
      await shot(page, size, "6-board-done");

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
