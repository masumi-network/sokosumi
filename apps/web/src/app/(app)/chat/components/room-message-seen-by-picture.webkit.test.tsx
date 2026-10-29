/**
 * Offline regression for delayed room read state after a terminal picture.
 * Uses the real row, receipt and room scroller: measure SSR, hydrate, deliver
 * read state through React, then check height, anchoring and corner hit-testing.
 * Run with `pnpm --filter web test:webkit` (Chromium + WebKit installed).
 */
import { type Browser, chromium, webkit } from "playwright";
import { renderToString } from "react-dom/server";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams(),
}));

import { startChatRowFixtureServer } from "@/app/chat/components/__tests__/chat-row-fixture-server";
import {
  PICTURE_URL,
  PicturePage,
} from "@/app/chat/components/__tests__/room-message-seen-by-picture-page";

const PAGE_MODULE =
  "/src/app/(app)/chat/components/__tests__/room-message-seen-by-picture-page.tsx";
const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="384"><rect width="1440" height="384" fill="black"/></svg>`;

let server: ViteDevServer;
const browsers: Browser[] = [];

beforeAll(async () => {
  const html = `<!doctype html><html lang="en"><head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script type="module">import "/src/app/globals.css";</script>
    </head><body><div id="fixture">${renderToString(<PicturePage />)}</div></body></html>`;
  server = await startChatRowFixtureServer({
    pageModule: PAGE_MODULE,
    html,
    // The viewport suite runs another Vite server concurrently with a different
    // dependency graph. Its optimization cache must not reload this page.
    cacheDir: ".vite-seen-by-picture",
  });
}, 120_000);

afterAll(async () => {
  await Promise.all(browsers.map((browser) => browser.close()));
  await server?.close();
});

describe.each([
  ["Chromium", chromium],
  ["WebKit", webkit],
])("%s", (_name, engine) => {
  it.each([
    ["desktop", { width: 1280, height: 800 }, null],
    ["phone", { width: 402, height: 714 }, null],
    ["phone with enlarged text", { width: 402, height: 714 }, "20px"],
  ])(
    "preserves layout and picture taps when read state arrives (%s)",
    async (_width, viewport, rootFontSize) => {
      const browser = await engine.launch({ chromiumSandbox: true });
      browsers.push(browser);
      const address = server.httpServer?.address();
      if (!address || typeof address === "string")
        throw new Error("Missing fixture port");
      const page = await browser.newPage({ viewport });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url === PICTURE_URL)
          return route.fulfill({ contentType: "image/svg+xml", body: PICTURE });
        if (new URL(url).hostname === "127.0.0.1") return route.continue();
        return route.abort();
      });
      await page.goto(`http://127.0.0.1:${address.port}/`);
      await page.waitForFunction(
        () =>
          getComputedStyle(document.body).margin === "0px" &&
          [...document.querySelectorAll("img")].every(
            (image) => image.complete && image.naturalWidth > 0,
          ),
      );
      if (rootFontSize)
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = size;
        }, rootFontSize);
      // This fixture has no virtualizer to place the normal-direction scroller at its live edge.
      await page.evaluate(() => {
        const scroller =
          document.querySelector<HTMLElement>(".overflow-y-auto")!;
        scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
      });
      const measure = () =>
        page.evaluate(() => {
          const row = document.querySelector('[data-row="newest"]')!;
          const scroller = document.querySelector(".overflow-y-auto")!;
          return {
            height: row.getBoundingClientRect().height,
            scrollHeight: scroller.scrollHeight,
            scrollTop: scroller.scrollTop,
            previousTop: document
              .getElementById("previous-message")!
              .getBoundingClientRect().top,
          };
        });
      const initial = await measure();
      expect(initial.height).toBeGreaterThan(100);
      await page.addScriptTag({
        type: "module",
        content: `try {
          const { hydratePicturePage } = await import(${JSON.stringify(PAGE_MODULE)});
          hydratePicturePage();
        } catch (error) { document.body.dataset.moduleError = String(error); }`,
      });
      await page
        .waitForSelector("body[data-hydrated],body[data-module-error]", {
          state: "attached",
        })
        .catch((error) => {
          throw new Error(`Hydration failed: ${errors.join("; ")}`, {
            cause: error,
          });
        });
      expect(await page.getAttribute("body", "data-module-error")).toBeNull();
      await page.locator("#read-state-arrives").click();
      await page.waitForSelector('[data-testid="room-seen-by-line"]');
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      expect(await measure()).toEqual(initial);
      expect(
        await page.getAttribute("body", "data-hydration-error"),
      ).toBeNull();
      expect(errors).toEqual([]);
      const corner = await page.evaluate(() => {
        const faces = document.querySelector(
          '[data-testid="room-seen-by-line"]',
        )!;
        const picture = document.querySelector('[data-row="newest"] img')!;
        const f = faces.getBoundingClientRect();
        const p = picture.getBoundingClientRect();
        const after = getComputedStyle(faces, "::after");
        const isPhone = after.display !== "none";
        const top = isPhone ? f.top + Number.parseFloat(after.top) : f.top;
        const bottom = isPhone
          ? f.bottom - Number.parseFloat(after.bottom)
          : f.bottom;
        const content = document
          .querySelector(".overflow-y-clip")!
          .getBoundingClientRect();
        const scroller = document
          .querySelector(".overflow-y-auto")!
          .getBoundingClientRect();
        return {
          visualGap: f.top - p.bottom,
          targetGap: top - p.bottom,
          visibleTargetHeight:
            Math.min(bottom, content.bottom, scroller.bottom) -
            Math.max(top, content.top, scroller.top),
          isPhone,
          pictureTapHitsReceipt:
            document
              .elementFromPoint(Math.min(f.right, p.right) - 4, p.bottom - 1)
              ?.closest('[data-testid="room-seen-by-line"]') != null,
        };
      });
      expect(corner.visualGap).toBeGreaterThanOrEqual(0);
      expect(corner.targetGap).toBeGreaterThanOrEqual(0);
      expect(corner.pictureTapHitsReceipt).toBe(false);
      if (corner.isPhone)
        expect(corner.visibleTargetHeight).toBeGreaterThanOrEqual(24);
    },
    120_000,
  );
});
