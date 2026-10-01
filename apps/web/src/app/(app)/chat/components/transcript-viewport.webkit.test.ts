/**
 * Regression: SOKOSUMI-SF / SOKOSUMI-SE, "Maximum update depth exceeded" on a
 * phone, thrown from the viewport's scroll-margin effect.
 *
 * The newest message carries the Seen by faces, and below `md` their touch
 * target hangs a couple of pixels past the list's bottom padding. WebKit adds
 * what overhangs the end of a reversed scroller to its `scrollHeight`;
 * Chromium does not. The viewport reads its top-based offset from
 * `scrollHeight`, so the scroll margin was two pixels larger while the newest
 * row was mounted. At the offset where that row leaves the overscan the two
 * chased each other: the margin dropped, the range took the row back, the
 * margin grew, the range dropped it again.
 *
 * Needs a real WebKit at a phone's width: happy-dom has no layout, and
 * Chromium never counts the overhang. Run with `pnpm --filter web test:webkit`
 * after `pnpm --filter web exec playwright install webkit`.
 */
import path from "node:path";

import react from "@vitejs/plugin-react";
import { type Browser, webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";

import type { TranscriptWalkResult } from "@/app/chat/components/__tests__/transcript-viewport-webkit-page";

const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const PAGE_MODULE =
  "/src/app/(app)/chat/components/__tests__/transcript-viewport-webkit-page.tsx";
/** The app's stylesheet, then the page: the bug is in what the CSS lays out. */
const PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script type="module">
      import "/src/app/globals.css";
      import ${JSON.stringify(PAGE_MODULE)};
    </script>
  </body>
</html>`;
/** Below `md`, where the Seen by touch target exists. */
const PHONE_VIEWPORT = { width: 402, height: 714 };

let server: ViteDevServer;
let browser: Browser;

beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: WEB_ROOT,
    logLevel: "error",
    plugins: [
      react(),
      {
        name: "transcript-viewport-webkit-page",
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            if (request.url !== "/") {
              next();
              return;
            }
            devServer
              .transformIndexHtml("/", PAGE_HTML)
              .then((html) => {
                response.setHeader("content-type", "text/html");
                response.end(html);
              })
              .catch(next);
          });
        },
      },
    ],
    resolve: {
      tsconfigPaths: true,
      alias: [
        {
          find: /^@sokosumi\/utils$/,
          replacement: path.resolve(
            WEB_ROOT,
            "../../packages/utils/src/index.ts",
          ),
        },
      ],
    },
    // Every dependency found before the page loads: one optimized late
    // reloads the page under the walk.
    optimizeDeps: { entries: [PAGE_MODULE.slice(1)] },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  browser = await webkit.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

it("keeps its scroll margin still while the newest row, Seen by faces and all, leaves the overscan", async () => {
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("the page server has no port");
  }
  const page = await browser.newPage({ viewport: PHONE_VIEWPORT });
  await page.goto(`http://127.0.0.1:${address.port}/`);
  // Attached, not visible: once the transcript has crashed the body is empty.
  await page.waitForSelector("body[data-walk]", {
    state: "attached",
    timeout: 60_000,
  });
  const result: TranscriptWalkResult = JSON.parse(
    (await page.getAttribute("body", "data-walk")) ?? "null",
  );

  // The walk started from the state that loops: newest row and its faces up.
  expect(result.newestRowMountedAtStart).toBe(true);
  expect(result.seenByMountedAtStart).toBe(true);
  expect(result.error).toBeNull();
  // It got as far as the row leaving, which is where it used to loop.
  expect(result.newestRowMountedAtEnd).toBe(false);
}, 90_000);
