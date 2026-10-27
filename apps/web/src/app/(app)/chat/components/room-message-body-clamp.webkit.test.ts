/**
 * A collapsed message body caps at 16 body lines and offers Show more, whatever
 * it holds. `line-clamp` counted only lines in the body's own flow, so tables
 * and code blocks (sideways scrollers) ran at full height with no Show more.
 * Needs real layout. Run with `pnpm --filter web test:webkit` (Chromium +
 * WebKit installed).
 */
import { type Browser, chromium, webkit } from "playwright";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startChatRowFixtureServer } from "@/app/chat/components/__tests__/chat-row-fixture-server";

const PAGE_MODULE =
  "/src/app/(app)/chat/components/__tests__/room-message-body-clamp-page.tsx";
/** 16 lines at the body's `leading-6`. */
const COLLAPSED_BODY_HEIGHT_PX = 16 * 24;

let server: ViteDevServer;

beforeAll(async () => {
  server = await startChatRowFixtureServer({
    pageModule: PAGE_MODULE,
    html: `<!doctype html><html lang="en"><head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <script type="module">import "/src/app/globals.css";</script>
      </head><body><div id="fixture"></div></body></html>`,
    cacheDir: ".vite-body-clamp",
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

  it.each([
    ["paragraphs", "room-message-body"],
    ["table", "room-message-body"],
    ["code", "room-message-body"],
    ["brief", "soko-bot-brief-body"],
  ])(
    "collapses a long %s body behind Show more",
    async (kind, bodyTestId) => {
      const address = server.httpServer?.address();
      if (!address || typeof address === "string")
        throw new Error("Missing fixture port");
      const page = await browser.newPage({
        viewport: { width: 1280, height: 800 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1"
          ? route.continue()
          : route.abort(),
      );
      await page.goto(`http://127.0.0.1:${address.port}/`);
      await page.waitForFunction(
        () => getComputedStyle(document.body).margin === "0px",
      );
      await page.addScriptTag({
        type: "module",
        content: `const { renderClampPage } = await import(${JSON.stringify(PAGE_MODULE)});
          renderClampPage();`,
      });
      const row = page.locator(`[data-row="${kind}"]`);
      const body = row.getByTestId(bodyTestId);
      await body.waitFor();

      await expect
        .poll(() => row.getByRole("button", { name: "Show more" }).count())
        .toBe(1);
      const collapsed = await body.evaluate(
        (node) => node.getBoundingClientRect().height,
      );
      expect(collapsed).toBeLessThanOrEqual(COLLAPSED_BODY_HEIGHT_PX + 1);

      await row.getByRole("button", { name: "Show more" }).click();
      await row.getByRole("button", { name: "Show less" }).waitFor();
      const expanded = await body.evaluate(
        (node) => node.getBoundingClientRect().height,
      );
      expect(expanded).toBeGreaterThan(COLLAPSED_BODY_HEIGHT_PX * 2);
      expect(errors).toEqual([]);
      await page.close();
    },
    60_000,
  );
});
