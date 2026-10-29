/**
 * Opening a docked side panel (thread, threads, pinned, members) moves the
 * room's 56rem content column as little as it can: it keeps its left edge
 * while it fits beside the panel, moves left only as far as it must, narrows
 * only at the pane edge, and slides there instead of jumping. Needs real
 * layout. Run with `pnpm --filter web test:webkit` (Chromium + WebKit
 * installed).
 */
import { type Browser, chromium, webkit } from "playwright";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startChatRowFixtureServer } from "@/app/chat/components/__tests__/chat-row-fixture-server";

const PAGE_MODULE =
  "/src/app/(app)/chat/components/__tests__/room-column-page.tsx";

let server: ViteDevServer;

beforeAll(async () => {
  server = await startChatRowFixtureServer({
    pageModule: PAGE_MODULE,
    html: `<!doctype html><html lang="en"><head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <script type="module">import "/src/app/globals.css";</script>
      </head><body><div id="fixture"></div></body></html>`,
    cacheDir: ".vite-room-column",
  });
}, 120_000);

afterAll(async () => {
  await server?.close();
});

describe.each([
  ["Chromium", chromium],
  ["WebKit", webkit],
])("%s", (_name, engine) => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await engine.launch({ chromiumSandbox: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  async function openRoom(paneWidth: number, reducedMotion = false) {
    const address = server.httpServer?.address();
    if (!address || typeof address === "string")
      throw new Error("Missing fixture port");
    const page = await browser.newPage({
      viewport: { width: paneWidth, height: 800 },
      reducedMotion: reducedMotion ? "reduce" : "no-preference",
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForFunction(
      () => getComputedStyle(document.body).margin === "0px",
    );
    await page.addScriptTag({
      type: "module",
      content: `const { renderRoomColumnPage } = await import(${JSON.stringify(PAGE_MODULE)});
        renderRoomColumnPage();`,
    });
    await page.waitForFunction(() => document.querySelector("main") !== null);
    return { page, errors };
  }

  /** Where the column rule puts the column: centred when closed, else
   * kept or moved left only as far as the panel needs. */
  function expected(pane: number, panel: number, rem: number) {
    const column = 56 * rem;
    const centred = Math.max(0, (pane - column) / 2);
    const left = Math.max(0, Math.min(centred, pane - panel - column));
    return { centred, left, width: Math.min(column, pane - panel - left) };
  }

  /** Layout lengths round to whole pixels. */
  function expectPx(actual: number, wanted: number) {
    expect(Math.abs(actual - wanted)).toBeLessThanOrEqual(1);
  }

  it.each([
    [2336, 420], // the gutter holds the panel: no move
    [1504, 420], // moves part of the way, not the full re-centre
    [1504, 320], // members: narrower panel, smaller move
    [1216, 420], // less than 56rem beside the panel: fills it
  ])(
    "a %ipx pane with a %ipx panel moves the column as little as it can",
    async (pane, panel) => {
      const { page, errors } = await openRoom(pane);
      const closed = await page.evaluate(() => window.columns());
      const want = expected(pane, panel, closed.rem);
      for (const column of [closed.list, closed.composer]) {
        expectPx(column.left, want.centred);
        expectPx(column.width, 56 * closed.rem);
      }

      await page.evaluate((width) => window.setPanel(width), panel);
      const open = await page.evaluate(() => window.columns());
      for (const column of [open.list, open.composer]) {
        expectPx(column.left, want.left);
        expectPx(column.width, want.width);
      }
      const moved = closed.composer.left - open.composer.left;
      expect(open.composer.slideFrom).toBe(
        moved === 0 ? null : `translateX(${moved}px)`,
      );

      await page.evaluate(() => window.setPanel(null));
      const reopened = await page.evaluate(() => window.columns());
      expect(reopened.composer.left).toBe(closed.composer.left);
      expect(errors).toEqual([]);
      await page.close();
    },
    60_000,
  );

  it("does not slide under reduced motion", async () => {
    const { page } = await openRoom(1504, true);
    await page.evaluate(() => window.setPanel(420));
    const open = await page.evaluate(() => window.columns());
    expectPx(open.composer.left, expected(1504, 420, open.rem).left);
    expect(open.composer.slideFrom).toBeNull();
    await page.close();
  }, 60_000);

  it("does not slide when the window resizes", async () => {
    const { page } = await openRoom(1504);
    await page.evaluate(() => window.setPanel(420));
    await page.waitForFunction(
      () => window.columns().composer.slideFrom === null,
    );
    await page.setViewportSize({ width: 1400, height: 800 });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    const resized = await page.evaluate(() => window.columns());
    expectPx(resized.composer.left, expected(1400, 420, resized.rem).left);
    expect(resized.composer.slideFrom).toBeNull();
    await page.close();
  }, 60_000);
});
