/**
 * Switching to a room painted from the retained transcript opens it at the
 * live edge from its first frame: the room's rows in view, and no
 * "Jump to latest" while the reader never left the newest message.
 *
 * The bug: the viewport's first range was computed at offset 0 with no
 * scroller size, so the rows mounted a render after the open scrolled to the
 * end. Rows taller than their estimate (result cards, images) left the first
 * frames blank or on older messages under "Jump to latest". Rows growing at
 * the live edge flashed the control while the scroll correction was clamped.
 *
 * Needs real layout: the happy-dom harness stubs the viewport. Runs in
 * Chromium; the timing is the virtualizer's, not an engine's. Run with
 * `pnpm --filter web test:webkit`.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import react from "@vitejs/plugin-react";
import { type Browser, chromium } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";

import type { RoomSwitchFrame } from "@/app/chat/components/__tests__/transcript-viewport-room-switch-page";

const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const PAGE_MODULE =
  "/src/app/(app)/chat/components/__tests__/transcript-viewport-room-switch-page.tsx";
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
/** Cloud sessions ship a Chromium here and not Playwright's own build. */
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";
/** Rooms visited in order: first visits, then revisits from the cache. */
const VISITS = ["b", "a", "b", "a"];
/** About a second and a half of frames per visit. */
const FRAMES_PER_VISIT = 90;

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
        name: "transcript-viewport-room-switch-page",
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            if (request.url?.split("?")[0] !== "/") {
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
    optimizeDeps: { entries: [PAGE_MODULE.slice(1)] },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  browser = await chromium.launch(
    existsSync(PREINSTALLED_CHROMIUM)
      ? { executablePath: PREINSTALLED_CHROMIUM }
      : {},
  );
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function visitRooms(query: string): Promise<RoomSwitchFrame[][]> {
  const address = server.httpServer?.address();
  if (!address || typeof address === "string")
    throw new Error("the page server has no port");
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  try {
    await page.goto(`http://127.0.0.1:${address.port}/?${query}`);
    await page.waitForFunction(() => typeof window.switchRoom === "function");
    const visits: RoomSwitchFrame[][] = [];
    for (const room of VISITS) {
      visits.push(
        await page.evaluate(
          ([room, frames]) => window.switchRoom(room, frames),
          [room, FRAMES_PER_VISIT] as const,
        ),
      );
    }
    return visits;
  } finally {
    await page.close();
  }
}

it.each([
  ["rows taller than their estimate", "tall"],
  ["previews that grow after mount", "previews"],
  ["both, then a mount refresh", "tall&previews&refresh"],
])(
  "opens each room at the live edge (%s)",
  async (_name, query) => {
    const visits = await visitRooms(query);
    const offEdge = visits.flatMap((frames, visit) =>
      frames
        // Frame 0 is sampled before the switch commits.
        .slice(1)
        .filter((frame) => frame.rowsInView === 0 || frame.jumpToLatest)
        .map((frame) => ({ visit, ...frame })),
    );
    expect(offEdge).toEqual([]);
    for (const frames of visits) {
      expect(frames.at(-1)?.distanceFromEnd).toBeLessThan(2);
    }
  },
  60_000,
);
