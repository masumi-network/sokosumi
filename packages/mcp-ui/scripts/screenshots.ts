/**
 * Screenshots every view in the host harness: the default and fullscreen
 * fixtures, and those marked `allWidths`, in light and dark at 320, 402 and
 * 768px; every other fixture (loading, empty, error, ...) at 402px; and the
 * first control focused from the keyboard; and the default fixture at 402px
 * after the host switches its theme while the view is open. A fixture's
 * `play` steps (fill a field, click a button) run before its shot. A shot
 * fails when the view did not load Inter. Build first.
 *
 *   node scripts/screenshots.ts [outDir]
 *
 * Set PLAYWRIGHT_CHANNEL=chrome to use the system Chrome when Playwright's
 * own browser is not downloaded.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { FIXTURES } from "../harness/fixtures.ts";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
const outDir = resolve(process.argv[2] ?? join(PACKAGE_DIR, "screenshots"));
const THEMES = ["light", "dark"] as const;
const WIDTHS = [320, 402, 768];
const STATE_WIDTH = 402;
const ALL_WIDTHS = new Set(["default", "fullscreen"]);
const STATES = new Set(["loading", "empty", "error", "approval"]);

const shots = Object.entries(FIXTURES).flatMap(([view, fixtures]) => [
  ...Object.entries(fixtures).flatMap(
    ([fixture, { allWidths, play = [], step }]) =>
      THEMES.flatMap((theme) =>
        (ALL_WIDTHS.has(fixture) || allWidths ? WIDTHS : [STATE_WIDTH]).map(
          (width) => ({
            view,
            fixture,
            theme,
            width,
            play,
            step,
            retheme: false,
          }),
        ),
      ),
  ),
  ...THEMES.map((theme) => ({
    view,
    fixture: "default",
    theme,
    width: STATE_WIDTH,
    play: [],
    step: undefined,
    retheme: true,
  })),
]);

mkdirSync(outDir, { recursive: true });
const server = await createServer({
  configFile: false,
  root: join(PACKAGE_DIR, "harness"),
  logLevel: "error",
  server: { port: 0, strictPort: false },
});
await server.listen();
const origin = server.resolvedUrls?.local[0];
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL,
});

try {
  for (const { view, fixture, theme, width, play, step, retheme } of shots) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      colorScheme: theme,
      reducedMotion: "reduce",
      deviceScaleFactor: 2,
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto(
      `${origin}?view=${view}&fixture=${fixture}&theme=${theme}${retheme ? "&retheme" : ""}`,
    );
    const expected = STATES.has(fixture) ? fixture : "ready";
    await page
      .frameLocator("iframe")
      .locator(`[data-state="${expected}"]`)
      .waitFor();
    await page.locator("iframe[data-sized]").waitFor();
    // Interactive states (confirm, submitting, ...): play the fixture's steps.
    const frame = page.frameLocator("iframe");
    for (const step of play) {
      if ("fill" in step) {
        await frame.getByLabel(step.fill).fill(step.value);
      } else {
        await frame
          .getByRole("button", { name: step.click, exact: true })
          .click();
      }
    }
    if (step) await frame.locator(`[data-step="${step}"]`).waitFor();
    if (play.length > 0) {
      // Off the last button, so the shot shows no hover.
      await page.mouse.move(0, 0);
      // The host resizes the iframe after the view reports its new height:
      // wait until two reads 100ms apart agree.
      const height = () =>
        page.locator("iframe").evaluate((iframe) => iframe.style.height);
      let previous = "";
      let current = await height();
      while (current !== previous) {
        await page.waitForTimeout(100);
        previous = current;
        current = await height();
      }
    }
    // Inter is embedded and loaded from bytes, under the spec's default CSP.
    const viewFrame = page.frames().find((frame) => frame !== page.mainFrame());
    const inter = await viewFrame?.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('500 14px "Sokosumi Inter"', "Ag");
    });
    if (!inter) errors.push("Inter did not load");
    if (retheme) {
      const next = theme === "dark" ? "light" : "dark";
      await page
        .frameLocator("iframe")
        .locator(`html[data-theme="${next}"]`)
        .waitFor({ state: "attached" });
    }
    if (errors.length > 0) {
      throw new Error(`${view}/${fixture}/${theme}: ${errors.join("; ")}`);
    }

    const name = retheme
      ? `${view}-retheme-${theme}-to-${theme === "dark" ? "light" : "dark"}`
      : `${view}-${fixture}-${theme}`;
    const file = join(outDir, `${name}-${width}.png`);
    await page.locator("iframe").screenshot({ path: file });
    console.log(file);

    // Keyboard reach: Tab into the view and show the focused control.
    if (fixture === "default" && width === STATE_WIDTH && !retheme) {
      await page.locator("iframe").focus();
      await page.keyboard.press("Tab");
      const focused = join(outDir, `${view}-focus-${theme}-${width}.png`);
      await page.locator("iframe").screenshot({ path: focused });
      console.log(focused);
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
