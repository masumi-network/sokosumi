import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { type Browser, chromium, type Page } from "playwright";

import { resolveBaseUrl } from "./base-url.ts";
import { createMailbox } from "./mailbox.ts";

// A first-time visitor with only the link: Register, the emailed code, a
// Personal workspace or an Organization, a Soko Bot, then its chat. Each test signs up a new
// throwaway user; nothing is paid for or connected.
const BASE_URL = resolveBaseUrl(process.env);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;

const PROJECTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];
const BOT = "Juno";
const QUESTION = "What should I set up first?";

let browser: Browser;
before(async () => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch();
});
after(() => browser.close());

/** The step's heading sits in the page's one main landmark. */
async function expectStep(page: Page, path: RegExp, heading: string) {
  await page.waitForURL(path);
  const main = page.getByRole("main");
  await main.getByRole("heading", { name: heading }).waitFor();
  assert.equal(await main.count(), 1, `${page.url()} has one main landmark`);
}

/** Reloads `url` until its transcript, drawn by the server, shows `text`. */
async function reloadUntilShown(page: Page, url: string, text: string) {
  const deadline = Date.now() + 60_000;
  await page.goto(url);
  for (;;) {
    const shown = page
      .getByRole("main")
      .getByText(text, { exact: true })
      .first();
    try {
      await shown.waitFor({ timeout: 5_000 });
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
    }
    await page.reload();
  }
}

/** Setup lists the same policies as sign-up, each a 24px-tall target. */
async function expectLegalLinks(page: Page) {
  for (const policy of [
    "Terms of Service",
    "Privacy Policy",
    "Imprint",
    "Acceptable Use",
  ]) {
    const box = await page
      .getByRole("link", { name: policy, exact: true })
      .last()
      .boundingBox();
    assert.ok(box && box.height >= 24, `${policy} is at least 24px tall`);
  }
}

/** The header logo's place and size, to hold setup's against sign-up's. */
async function logoBox(page: Page) {
  const box = await page
    .getByRole("img", { name: "Sokosumi Logo", exact: true })
    .filter({ visible: true })
    .first()
    .boundingBox();
  assert.ok(box, `${page.url()} shows the logo`);
  return box;
}

for (const { name, ...viewport } of PROJECTS) {
  describe(name, () => {
    test("a new visitor signs up and meets their Soko Bot", async () => {
      const mailbox = await createMailbox();
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shot = (step: string) =>
        page.screenshot({
          path: `${RESULTS_DIR}onboarding-${name}-${step}.png`,
        });

      await page.goto(`${BASE_URL}/`);
      const register = page.getByRole("link", { name: "Register" });
      // WCAG 2.5.8: the first tap a new visitor makes is at least 24px tall.
      const registerBox = await register.boundingBox();
      assert.ok(
        registerBox && registerBox.height >= 24,
        "Register is 24px tall",
      );
      // Like the visitor in the demo, they try Log in first. The notice
      // that asks for a typo check shows the whole address, which a phone's
      // field cuts short.
      await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page
        .getByTestId("email-step-detour")
        .getByText(mailbox.address, { exact: true })
        .waitFor();
      await shot("0-no-account");
      // The link ignores a click in its first 400ms (a double-click guard).
      await page.waitForTimeout(500);
      await page.getByRole("link", { name: "Create account" }).click();
      await expectStep(page, /\/signup/, "Create your account");
      const signupLogo = await logoBox(page);

      // The chip is named by the address it shows, then what it does.
      await page
        .getByRole("button", { name: `${mailbox.address} Change email` })
        .waitFor();
      await page.getByRole("textbox", { name: "First name" }).fill("Ada");
      await page.getByRole("textbox", { name: "Last name" }).fill(name);
      // An added password gets focus and a label that outlasts typing, like
      // the names; persona A then goes on without one.
      await page
        .getByRole("button", { name: "Add a password for future logins" })
        .click();
      // Focus moves on the frame after the field appears; wait for it.
      await page.getByRole("textbox", { name: "Password" }).waitFor();
      await page.waitForFunction(
        () => document.activeElement?.getAttribute("name") === "password",
      );
      const passwordLabel = await page
        .locator("label", { hasText: /^Password$/ })
        .boundingBox();
      // A screen-reader-only label is 1px wide.
      assert.ok(
        passwordLabel && passwordLabel.width > 20,
        "the password label shows above its field",
      );
      await page
        .getByRole("button", { name: "Sign up without a password" })
        .click();
      const codeField = page.getByRole("textbox", {
        name: "Code from the email",
      });
      // A paste with no clipboard, as Lighthouse and some autofill tools
      // send, must not throw.
      await codeField.dispatchEvent("paste");
      await codeField.pressSequentially(await mailbox.nextCode());
      await shot("1-code");
      await page.getByRole("button", { name: "Register" }).click();

      await expectStep(page, /\/setup$/, "How do you want to work?");
      await expectLegalLinks(page);
      // The logo stays put from sign-up to setup.
      assert.deepEqual(await logoBox(page), signupLogo);
      await shot("2-workspace");
      await page.getByRole("button", { name: "Continue" }).click();

      await expectStep(page, /\/setup\/assistant$/, "Name your Soko Bot");
      // An empty name gets the page's own error, not the browser's bubble.
      await page.getByRole("button", { name: "Continue" }).click();
      await page
        .getByRole("alert")
        .filter({ hasText: "Enter a name." })
        .waitFor();
      await page.getByRole("textbox", { name: "Name" }).fill(BOT);
      await page.getByRole("button", { name: "Continue" }).click();
      await page
        .getByRole("heading", { name: `Choose a look for ${BOT}` })
        .waitFor();
      // Create is pinned to the foot at every size, so it is on screen before
      // any scroll, with the options still to pick above it.
      const create = page.getByRole("button", { name: `Create ${BOT}` });
      await create.and(page.locator(":enabled")).waitFor();
      const createBox = await create.boundingBox();
      assert.ok(
        createBox &&
          createBox.y >= 0 &&
          createBox.y + createBox.height <= viewport.height,
        "Create is on screen when Create can be pressed",
      );

      // Every animal is a real target at every size; viewport breakpoints once
      // drew them 8px wide in setup's narrow frame. DESIGN.md touch targets:
      // 40px below md (768), 32px from md up.
      const minTarget = viewport.width < 768 ? 40 : 32;
      const owl = page.getByRole("button", { name: "Owl", exact: true });
      const owlBox = await owl.boundingBox();
      assert.ok(
        owlBox && owlBox.width >= minTarget && owlBox.height >= minTarget,
        `the Owl tile is at least ${minTarget}px square`,
      );
      await owl.click();
      assert.equal(await owl.getAttribute("aria-pressed"), "true");
      await shot("3-picture");

      // The rest of the look folds under More details. Open, every control
      // stays inside the studio's frame, a pick survives a fold, and the last
      // option clears the pinned Create.
      const more = page.getByRole("button", { name: /More details/ });
      const closedCreate = await create.boundingBox();
      await more.click();
      // It sits by the pinned Create, so what it opens starts below the
      // screen; the page brings it up once the fold has opened.
      await page.waitForFunction(() => {
        const background = document.querySelector(
          "[role=radiogroup][aria-label='Background']",
        );
        const top = background?.getBoundingClientRect().top;
        return top !== undefined && top >= 0 && top < window.innerHeight / 2;
      });
      // The studio's own box; the frame around it has padding that hides overflow.
      const studio = owl.locator(
        "xpath=ancestor::div[contains(@class,'@container')]",
      );
      const frame = await studio.boundingBox();
      const sticking = await studio
        .locator("button, [role=radio]")
        .evaluateAll(
          (els, right) =>
            els.filter((el) => el.getBoundingClientRect().right > right + 0.5)
              .length,
          (frame?.x ?? 0) + (frame?.width ?? 0),
        );
      assert.equal(sticking, 0, "no studio control sticks out of its frame");
      // The big preview is now above the screen; a small live one beside Back
      // and Create shows each pick, and leaves with the fold.
      const mini = create.locator("xpath=..").locator("img");
      await mini.waitFor();
      // Back drops to its icon so the mini costs Create no width: a name that
      // fits with More details closed still fits with it open.
      const openCreate = await create.boundingBox();
      assert.ok(
        closedCreate &&
          openCreate &&
          openCreate.width >= closedCreate.width - 0.5,
        "Create is as wide with More details open as closed",
      );
      const backBox = await page
        .getByRole("button", { name: "Back", exact: true })
        .boundingBox();
      assert.ok(
        backBox && backBox.width >= minTarget && backBox.height >= minTarget,
        `Back stays a ${minTarget}px target`,
      );
      const before = await mini.getAttribute("src");
      const headwear = page.getByRole("radiogroup", { name: "Headwear" });
      // The look starts random, so pick a headwear it does not wear yet:
      // only a real change can change the picture.
      const pick = headwear
        .locator("[role=radio][aria-checked=false]:enabled")
        .first();
      const picked = (await pick.textContent())?.trim() ?? "";
      await pick.click();
      await page.waitForFunction(
        ([el, src]) => el?.getAttribute("src") !== src,
        [await mini.elementHandle(), before] as const,
      );
      await more.click();
      await mini.waitFor({ state: "detached" });
      await more.click();
      await mini.waitFor();
      assert.equal(
        await headwear
          .getByRole("radio", { name: picked, exact: true })
          .getAttribute("aria-checked"),
        "true",
        "a pick survives folding More details",
      );
      const star = headwear.getByRole("radio", { name: "Star" });
      await star.focus();
      const starBox = await star.boundingBox();
      const pinned = await create.boundingBox();
      assert.ok(
        starBox &&
          pinned &&
          starBox.y + starBox.height <= pinned.y &&
          pinned.y + pinned.height <= viewport.height,
        "the last option clears Create, which stays on screen",
      );
      await create.click();

      await expectStep(
        page,
        /\/setup\/assistant\/connect$/,
        `Give ${BOT} your inbox and calendar`,
      );
      await page.getByRole("link", { name: "Skip" }).click();

      await page.waitForURL(/\/chat\/rooms\//);
      const message = page.getByRole("textbox", { name: `Message ${BOT}` });
      await message.waitFor();
      // Screen readers hear the bot as what it is, a Soko Bot, not an Agent.
      await page
        .getByRole("main")
        .getByRole("button", { name: `${BOT} (Soko Bot)`, exact: true })
        .first()
        .waitFor();
      // The room header shows who the Direct is with at every width, as the
      // sidebar row does, not a generic chat icon.
      await page
        .locator("[data-testid=room-title-face]:visible")
        .first()
        .waitFor();
      const banner = page.getByRole("banner");
      const globalSearch = banner.getByRole("button", {
        name: "Search",
        exact: true,
      });
      const newTask = banner.getByRole("button", { name: /^New task/ });
      if (viewport.width < 768) {
        // On a phone the room's name and subtitle get the header row whole:
        // the global Search and New task step aside, and nothing is cut.
        assert.ok(await globalSearch.isHidden(), "no global Search in a room");
        assert.ok(await newTask.isHidden(), "no New task button in a room");
        for (const id of ["room-open-title", "room-open-subtitle"]) {
          const cut = await banner
            .getByTestId(id)
            .evaluate((el) => el.scrollWidth > el.clientWidth);
          assert.ok(!cut, `${id} fits the phone header`);
        }
        // Alt+N still opens New task from the room, outside a text field.
        await page.evaluate(() =>
          (document.activeElement as HTMLElement | null)?.blur(),
        );
        await page.keyboard.press("Alt+KeyN");
        const wizard = page.getByRole("dialog", { name: "New task" });
        await wizard.waitFor();
        await page.keyboard.press("Escape");
        await wizard.waitFor({ state: "hidden" });
      }
      await message.fill(QUESTION);
      await page.getByRole("button", { name: "Send message" }).click();
      await shot("4-chat");
      // The question shows at once, before the server has it, and a quick
      // save shows no tick. A second tab, so this one keeps sending, reads
      // the room from the server until the question is there.
      const saved = await context.newPage();
      saved.on("pageerror", (e) => errors.push(e.message));
      await reloadUntilShown(saved, page.url(), QUESTION);
      // Home lists the chat with the bot: "You to Juno" while the answer is
      // on its way, then "Juno replied" with the answer. The bot answers on
      // its own clock, so wait for the final row instead of racing the
      // first one.
      await reloadUntilShown(saved, `${BASE_URL}/`, `${BOT} replied`);
      const row = saved
        .getByRole("main")
        .getByRole("link", { name: new RegExp(`${BOT} replied`) });
      assert.ok(
        !(await row.textContent())?.includes(QUESTION),
        "the row shows the answer, not the question",
      );
      await saved.screenshot({
        path: `${RESULTS_DIR}onboarding-${name}-5-home.png`,
      });
      // Every composer tool shows: on a phone Home's padding once pushed
      // "Add a skill" out of the toolbar's visible width.
      const skillShown = await saved
        .getByRole("main")
        .getByRole("button", { name: "Add a skill" })
        .evaluate((button) => {
          const bar = button.parentElement?.getBoundingClientRect();
          const box = button.getBoundingClientRect();
          return !!bar && box.left >= bar.left && box.right <= bar.right + 1;
        });
      assert.ok(skillShown, "Add a skill shows inside the composer toolbar");
      const showSidebar = saved.getByRole("button", { name: "Show sidebar" });
      if (viewport.width >= 768 && (await showSidebar.isVisible())) {
        // With the sidebar folded, the rail's workspace button is a face
        // alone; its name says what it does and which workspace is on.
        await saved
          .getByRole("button", {
            name: "Switch workspace (current: Personal)",
            exact: true,
          })
          .waitFor();
      }
      // They picked Personal, so the switcher says Personal, not their name.
      if (await showSidebar.isVisible()) await showSidebar.click();
      // The bot is one row under Direct messages: its Direct, with the
      // team's Soko Bots at its end. It and the phone's All chats sit on the
      // same column as the rows around them, not 8px further in.
      const rows: Record<string, string> = {
        home: '[data-sidebar="menu-button"][href$="/chat"]',
        sokoBot:
          '[data-slot="room-row-main"]:has(a[href$="/agents"]) [data-sidebar="menu-button"]',
        ...(viewport.width < 768 && {
          allChats: '[data-sidebar="menu-button"][href$="/chat/rooms"]',
        }),
      };
      for (const selector of Object.values(rows)) {
        await saved
          .locator(selector)
          .filter({ visible: true })
          .first()
          .waitFor();
      }
      // The sheet and the sidebar slide in, so every row is read in one
      // frame, once two frames in a row agree.
      const lefts = await saved.evaluate(async (selectors) => {
        const read = () =>
          JSON.stringify(
            Object.fromEntries(
              Object.entries(selectors).map(([key, selector]) => {
                const row = [...document.querySelectorAll(selector)].find(
                  (el) => el.getBoundingClientRect().width > 0,
                );
                return [
                  key,
                  Math.round(row?.getBoundingClientRect().left ?? -1),
                ];
              }),
            ),
          );
        const frame = () => new Promise((done) => requestAnimationFrame(done));
        let last = read();
        for (let i = 0; i < 120; i++) {
          await frame();
          const next = read();
          if (next === last) break;
          last = next;
        }
        return JSON.parse(last) as Record<string, number>;
      }, rows);
      for (const [key, left] of Object.entries(lefts)) {
        assert.equal(left, lefts.home, `${key} starts where Home does`);
      }
      const botRows = await saved
        .locator('[data-sidebar="menu-button"][href$="/personal-assistant"]')
        .filter({ visible: true })
        .count();
      assert.equal(botRows, 0, `${BOT} is listed once`);
      await saved
        .getByRole("button", { name: "Personal", exact: true })
        .click();
      await saved
        .getByRole("menuitem", { name: /^Personal\b.*Just you$/ })
        .waitFor();
      await saved.keyboard.press("Escape");
      // The people icon at the end of the bot's row is its own target: it
      // opens the team's Soko Bots, not the row's chat or its menu, and on a
      // phone it closes the sheet like any sidebar link.
      const team = saved
        .locator('[data-slot="room-row-main"]')
        .filter({ visible: true })
        .getByRole("link", { name: "Your team's Soko Bots", exact: true });
      const sidebarUrl = saved.url();
      // Pressed 2px inside its right edge, next to the menu: still the team.
      const teamBox = await team.boundingBox();
      assert.ok(teamBox, "the team link has a box");
      assert.ok(
        teamBox.width >= (viewport.width < 768 ? 40 : 32),
        "the team link is a full target",
      );
      await team.click({
        position: { x: teamBox.width - 2, y: teamBox.height / 2 },
      });
      await saved.waitForURL(/\/agents$/);
      await saved
        .locator('[data-slot="sidebar"][data-mobile="true"]')
        .waitFor({ state: "detached" });
      // Back where it was, with the sidebar open again.
      await saved.goBack();
      await saved.waitForURL(sidebarUrl);
      if (await showSidebar.isVisible()) await showSidebar.click();
      await team.waitFor();
      if (viewport.width < 768) {
        // Back to chats is one tap to the phone's global Search and New task.
        await page.getByRole("link", { name: "Back to chats" }).click();
        await page.waitForURL(/\/chat\/rooms$/);
        await globalSearch.waitFor();
        await newTask.waitFor();
      }
      await context.close();
      assert.deepEqual(errors, []);
    });

    test("a new visitor sets up an Organization and meets their Soko Bot", async () => {
      const mailbox = await createMailbox();
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await page.goto(`${BASE_URL}/`);
      await page.getByRole("link", { name: "Register" }).click();
      await expectStep(page, /\/signup/, "Create your account");
      await page.getByRole("textbox", { name: "Email" }).fill(mailbox.address);
      await page.getByRole("button", { name: "Continue with email" }).click();
      await page.getByRole("textbox", { name: "First name" }).fill("Ada");
      await page.getByRole("textbox", { name: "Last name" }).fill(name);
      await page
        .getByRole("textbox", { name: "Code from the email" })
        .pressSequentially(await mailbox.nextCode());
      await page.getByRole("button", { name: "Register" }).click();

      await expectStep(page, /\/setup$/, "How do you want to work?");
      await page.getByRole("radio", { name: /Organization/ }).click();
      await page.getByRole("button", { name: "Continue" }).click();

      // An empty Continue names both missing fields at once, and each field
      // is described by its own error, not the other's.
      const dialog = page.getByRole("dialog", { name: "Create organization" });
      const orgName = dialog.getByRole("textbox", { name: "Name" });
      const website = dialog.getByRole("textbox", { name: "Website" });
      await dialog.getByRole("button", { name: "Continue" }).click();
      const nameError = "Enter a name with at least 2 characters.";
      const urlError = "Enter a valid website, like https://acme.com";
      await dialog.getByRole("alert").filter({ hasText: urlError }).waitFor();
      assert.deepEqual(await dialog.getByRole("alert").allTextContents(), [
        nameError,
        urlError,
      ]);
      assert.equal(
        await orgName.evaluate((el) => el.getAttribute("aria-describedby")),
        await dialog
          .getByRole("alert")
          .filter({ hasText: nameError })
          .getAttribute("id"),
      );
      assert.equal(
        await website.evaluate((el) => el.getAttribute("aria-describedby")),
        await dialog
          .getByRole("alert")
          .filter({ hasText: urlError })
          .getAttribute("id"),
      );
      await page.screenshot({
        path: `${RESULTS_DIR}onboarding-${name}-org-errors.png`,
      });

      await orgName.fill("Ada Test Studio");
      await website.fill("example.com");
      await dialog.getByRole("button", { name: "Continue" }).click();
      // The logo step reads "Skip for now", or "Continue" once the site's icon
      // resolves first. Wait for the step so the name step's Continue is gone.
      await dialog.getByRole("heading", { name: "Your logo" }).waitFor();
      await dialog
        .getByRole("button", { name: /^(Skip for now|Continue)$/ })
        .click();
      await dialog.getByRole("button", { name: "Finish setup" }).click();
      await dialog.getByRole("button", { name: "Go to workspace" }).click();

      await expectStep(page, /\/setup\/assistant$/, "Name your Soko Bot");
      await page.getByRole("textbox", { name: "Name" }).fill(BOT);
      await page.getByRole("button", { name: "Continue" }).click();
      const create = page.getByRole("button", { name: `Create ${BOT}` });
      await create.and(page.locator(":enabled")).click();
      await expectStep(
        page,
        /\/setup\/assistant\/connect$/,
        `Give ${BOT} your inbox and calendar`,
      );
      await page.getByRole("link", { name: "Skip" }).click();
      await page.waitForURL(/\/chat\/rooms\//);
      await page.getByRole("textbox", { name: `Message ${BOT}` }).waitFor();
      await context.close();
      assert.deepEqual(errors, []);
    });
  });
}
