/**
 * Offline regression for delayed room read state after a terminal picture.
 * Uses the real row, receipt and room scroller: measure SSR, hydrate, deliver
 * read state through React, then check height, anchoring and corner hit-testing.
 * Run with `pnpm --filter web test:webkit` (Chromium + WebKit installed).
 */
import path from "node:path";

import { type Browser, chromium, webkit } from "playwright";
import { renderToString } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams(),
}));

import {
  PICTURE_URL,
  PicturePage,
} from "@/app/chat/components/__tests__/room-message-seen-by-picture-page";

const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../..");
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
  server = await createServer({
    // The app's own resolution and React plugin, read from its Vitest config.
    configFile: path.join(WEB_ROOT, "vitest.config.ts"),
    root: WEB_ROOT,
    // The viewport suite runs another Vite server concurrently with a different
    // dependency graph. Its optimization cache must not reload this page.
    cacheDir: path.join(WEB_ROOT, "node_modules/.vite-seen-by-picture"),
    logLevel: "error",
    define: { "process.env": JSON.stringify({ NODE_ENV: "development" }) },
    plugins: [
      {
        name: "room-message-seen-by-picture-page",
        enforce: "pre",
        // Mock navigation, presence and server mutation boundaries. Row,
        // receipts, attachment previews and CSS stay real in both runtimes.
        resolveId(id) {
          if (id === "next/navigation") return "\0fixture-navigation";
          if (id === "@/contexts/org-presence-provider")
            return "\0fixture-presence";
          if (id === "@/app/chat/actions") return "\0fixture-room-action";
          if (id === "@/lib/actions/soko-bot/action") return "\0fixture-action";
          if (id === "./select-project-action")
            return "\0fixture-project-action";
        },
        load(id) {
          if (id === "\0fixture-presence") {
            return `export const useMemberPresence = (_id, fallback) => fallback;`;
          }
          if (id === "\0fixture-room-action") {
            return `const forbidden = () => {throw new Error('Room actions forbidden in this fixture');};
              export const createDirectRoomAction = forbidden;
              export const ensureCoworkerDirectRoomAction = forbidden;
              export const ensureSokoBotDirectRoomAction = forbidden;`;
          }
          if (id === "\0fixture-navigation") {
            return `export const useRouter = () => ({push(){}, replace(){}, refresh(){}});
              export const usePathname = () => '/chat';
              export const useSearchParams = () => new URLSearchParams();`;
          }
          if (id === "\0fixture-action") {
            return `const forbidden = () => {
              throw new Error('Server mutations are forbidden in this fixture');
            };
              export const sendSokoBotTurnFeedbackAction = forbidden;
              export const resolveSokoBotDecisionAction = forbidden;`;
          }
          if (id === "\0fixture-project-action") {
            return `export const selectChatProjectAction = () => {
              throw new Error('Server mutations are forbidden in this fixture');
            };`;
          }
        },
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            if (request.url !== "/") return next();
            devServer
              .transformIndexHtml("/", html)
              .then((transformed) => {
                response.setHeader("content-type", "text/html");
                response.end(transformed);
              })
              .catch(next);
          });
        },
      },
    ],
    optimizeDeps: {
      entries: [PAGE_MODULE.slice(1)],
      exclude: ["next/navigation"],
    },
    // A fixture never changes on disk while a case runs. Hot reload would
    // discard its SSR baseline if dependency optimization discovers an import.
    server: { host: "127.0.0.1", port: 0, hmr: false },
  });
  await server.listen();
  // Transform the client graph before measuring SSR. Loading a new optimized
  // dependency during hydration would reload the page and erase the transition.
  await server.environments.client.warmupRequest(PAGE_MODULE);
  await server.environments.client.waitForRequestsIdle();
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
