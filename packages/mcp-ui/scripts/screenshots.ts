/**
 * Screenshots every view in the host harness: the default and fullscreen
 * fixtures in light and dark at 320, 402 and 768px; every other fixture
 * (loading, empty, error, ...) at 402px; and the first control focused from
 * the keyboard. Build first.
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
const STATES = new Set(["loading", "empty", "error"]);

const shots = Object.entries(FIXTURES).flatMap(([view, fixtures]) =>
  Object.keys(fixtures).flatMap((fixture) =>
    THEMES.flatMap((theme) =>
      (ALL_WIDTHS.has(fixture) ? WIDTHS : [STATE_WIDTH]).map((width) => ({
        view,
        fixture,
        theme,
        width,
      })),
    ),
  ),
);

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
  for (const { view, fixture, theme, width } of shots) {
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

    await page.goto(`${origin}?view=${view}&fixture=${fixture}&theme=${theme}`);
    const expected = STATES.has(fixture) ? fixture : "ready";
    await page
      .frameLocator("iframe")
      .locator(`[data-state="${expected}"]`)
      .waitFor();
    await page.locator("iframe[data-sized]").waitFor();
    if (errors.length > 0) {
      throw new Error(`${view}/${fixture}/${theme}: ${errors.join("; ")}`);
    }

    const file = join(outDir, `${view}-${fixture}-${theme}-${width}.png`);
    await page.locator("iframe").screenshot({ path: file });
    console.log(file);

    // Keyboard reach: Tab into the view and show the focused control.
    if (fixture === "default" && width === STATE_WIDTH) {
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
