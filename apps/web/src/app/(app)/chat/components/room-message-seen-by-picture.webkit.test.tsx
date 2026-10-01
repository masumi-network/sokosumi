/**
 * Regression: switching to a channel whose newest message ends in a picture
 * made the transcript jump.
 *
 * The Seen by faces arrive after the transcript (the read state is a second
 * request), and only then does the newest row reserve room for them: an
 * inline span after the body, meant to shorten the last line of text. After a
 * picture there is no line to shorten, so the span opened a line of its own
 * and the row grew by a line height. The transcript is anchored to the
 * bottom, so everything above moved up as the faces landed.
 *
 * Now the newest row keeps just the corner the faces need below a trailing
 * picture, from the first paint: same height before and after they arrive,
 * and the faces never sit on the picture, even one as wide as the column.
 *
 * Needs a real browser: happy-dom has no layout. The row's markup is the real
 * `ChatMessageRow` with the real faces, rendered here; the browser only lays
 * it out with the app's stylesheet. Run with `pnpm --filter web test:webkit`
 * after `pnpm --filter web exec playwright install webkit chromium`.
 */
import path from "node:path";

import type {
  ChatRoomMessage,
  ChatRoomUserParticipant,
} from "@sokosumi/core-client";
import { NextIntlClientProvider } from "next-intl";
import { type Browser, chromium, webkit } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams(),
}));

import { ChatMessageRow } from "@/app/chat/components/room-message-row";
import { RoomSeenByLine } from "@/app/chat/components/room-seen-by-line";
import type { RoomReader } from "@/app/chat/hooks/use-room-read-receipts";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createFormats } from "@/i18n/time-format";
import messages from "@/messages/en.json";

const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const PICTURE_URL = "https://picture-fixture.invalid/uploads/cmo.png";
/** A wide logo, as in the report: on a phone it spans the whole column. */
const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="384"><rect width="1440" height="384" fill="black"/></svg>`;

interface Layout {
  withoutFaces: number;
  withFaces: number;
  /** Pixels of the faces' box that land on the picture. */
  facesOnPicture: number;
}

function participant(index: number): ChatRoomUserParticipant {
  return {
    id: `user-${index}`,
    name: `Reader ${index}`,
    email: `reader-${index}@example.com`,
    image: null,
    presence: "offline",
  };
}

const READERS: RoomReader[] = [2, 3, 4, 5].map((index) => ({
  participant: participant(index),
  lastReadAt: new Date(Date.UTC(2026, 9, 1, 13, 30 + index)),
}));

const MESSAGE = {
  id: "msg-newest",
  roomId: "room-1",
  parentMessageId: null,
  content: `because I wanted to verify an implementation, I created a logo and icon.\n\n[cmo.png](${PICTURE_URL})`,
  createdAt: new Date(Date.UTC(2026, 9, 1, 13, 28)),
  deletedAt: null,
  editedAt: null,
  pinnedAt: null,
  sender: { type: "user", user: participant(1) },
  mentions: [],
  reactions: [],
  threadReplyCount: 0,
  threadLastReplyAt: null,
  metadata: null,
  quote: null,
  membership: null,
  groupNameChange: null,
  unfurls: null,
} as unknown as ChatRoomMessage;

function rowMarkup(faces: boolean): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="UTC"
      formats={createFormats("h23")}
    >
      <TooltipProvider>
        <div data-row={faces ? "with" : "without"}>
          <ChatMessageRow
            message={MESSAGE}
            coworkersById={new Map()}
            coworkersBySlug={new Map()}
            onToggleReaction={() => {}}
            newestEndsInAttachment
            seenBy={
              faces ? (
                <RoomSeenByLine
                  readers={READERS}
                  receipts={{ readers: READERS, nonReaders: [] }}
                />
              ) : undefined
            }
          />
        </div>
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
}

/** The row without and with the faces, measured once the pictures load. */
function pageHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script type="module">import "/src/app/globals.css";</script>
  </head>
  <body>
    ${rowMarkup(false)}${rowMarkup(true)}
    <script>
      const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const row = (which) => document.querySelector('[data-row="' + which + '"]');
      (async () => {
        for (let tries = 0; tries < 600; tries += 1) {
          const images = [...document.querySelectorAll("img")];
          const styled = getComputedStyle(document.body).margin === "0px";
          if (styled && images.length >= 2 && images.every((image) => image.complete && image.naturalWidth > 0)) break;
          await frame();
        }
        await frame();
        const faces = row("with").querySelector('[data-testid="room-seen-by-line"]').getBoundingClientRect();
        const picture = row("with").querySelector("img").getBoundingClientRect();
        const overlap = (Math.max(0, Math.min(faces.right, picture.right) - Math.max(faces.left, picture.left)))
          * (Math.max(0, Math.min(faces.bottom, picture.bottom) - Math.max(faces.top, picture.top)));
        document.body.dataset.layout = JSON.stringify({
          withoutFaces: row("without").getBoundingClientRect().height,
          withFaces: row("with").getBoundingClientRect().height,
          facesOnPicture: overlap,
        });
      })();
    </script>
  </body>
</html>`;
}

let server: ViteDevServer;
const browsers: Browser[] = [];

beforeAll(async () => {
  const html = pageHtml();
  server = await createServer({
    configFile: false,
    root: WEB_ROOT,
    logLevel: "error",
    plugins: [
      {
        name: "room-message-seen-by-picture-page",
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            if (request.url !== "/") {
              next();
              return;
            }
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
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
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
    ["desktop", { width: 1280, height: 800 }],
    ["phone", { width: 402, height: 714 }],
  ])(
    "keeps a picture message's height when the Seen by faces arrive (%s)",
    async (_width, viewport) => {
      const browser = await engine.launch();
      browsers.push(browser);
      const address = server.httpServer?.address();
      if (!address || typeof address === "string") {
        throw new Error("the page server has no port");
      }
      const page = await browser.newPage({ viewport });
      await page.route(PICTURE_URL, (route) =>
        route.fulfill({ contentType: "image/svg+xml", body: PICTURE }),
      );
      await page.goto(`http://127.0.0.1:${address.port}/`);
      await page.waitForSelector("body[data-layout]", {
        state: "attached",
        timeout: 30_000,
      });
      const layout: Layout = JSON.parse(
        (await page.getAttribute("body", "data-layout")) ?? "null",
      );

      // The picture rendered, so the row is taller than its text.
      expect(layout.withoutFaces).toBeGreaterThan(100);
      expect(layout.withFaces).toBe(layout.withoutFaces);
      // In the corner, below the picture, not on it.
      expect(layout.facesOnPicture).toBe(0);
    },
    120_000,
  );
});
