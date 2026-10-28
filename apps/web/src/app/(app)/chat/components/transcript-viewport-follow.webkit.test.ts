/**
 * A reader at the live edge keeps the newest message above the composer
 * while a draft grows it line by line, and after the draft is sent.
 *
 * The draft's resize reached the viewport only through the virtualizer's
 * onChange, which runs when the mounted rows change, so a growing composer
 * covered the newest message. On send the composer shrinks back, and the
 * resize was applied on top of the append's follow: the view landed the
 * composer's growth above the end, the sent message half behind it.
 *
 * Real rows in the real shell, in Chromium (the reported browser) and
 * WebKit. Run with `pnpm --filter web test:webkit`.
 */
import { type Browser, chromium, webkit } from "playwright";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startChatRowFixtureServer } from "@/app/chat/components/__tests__/chat-row-fixture-server";

const PAGE_MODULE =
  "/src/app/(app)/chat/components/__tests__/transcript-viewport-follow-page.tsx";

let server: ViteDevServer;

beforeAll(async () => {
  server = await startChatRowFixtureServer({
    pageModule: PAGE_MODULE,
    html: `<!doctype html><html lang="en"><head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <script type="module">import "/src/app/globals.css";</script>
      </head><body><div id="fixture"></div></body></html>`,
    cacheDir: ".vite-transcript-follow",
  });
}, 120_000);

afterAll(async () => {
  await server?.close();
});

describe.each([
  ["Chromium", chromium],
  ["WebKit", webkit],
])("%s", (_engineName, engine) => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await engine.launch();
  });

  afterAll(async () => {
    await browser?.close();
  });

  it.each([
    ["desktop", { width: 1400, height: 900 }],
    ["phone", { width: 402, height: 714 }],
  ])(
    "keeps the newest message above the composer while a draft grows and after it is sent (%s)",
    async (_viewportName, viewport) => {
      const address = server.httpServer?.address();
      if (!address || typeof address === "string")
        throw new Error("Missing fixture port");
      const page = await browser.newPage({ viewport });
      try {
        await page.goto(`http://127.0.0.1:${address.port}/`);
        await page.waitForFunction(
          () => getComputedStyle(document.body).margin === "0px",
        );
        await page.addScriptTag({
          type: "module",
          content: `const { renderFollowPage } = await import(${JSON.stringify(PAGE_MODULE)});
            renderFollowPage();`,
        });
        await page.waitForFunction(
          () => document.body.dataset.atEnd === "true",
        );
        // The newest row's bottom below the scroller's, after the frames that
        // follow each step have painted. Positive: hidden behind the composer.
        const overhangs = await page.evaluate(async () => {
          const settle = async () => {
            for (let frame = 0; frame < 6; frame += 1)
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => setTimeout(resolve, 0)),
              );
          };
          const overhang = () => {
            const scroller =
              document.querySelector<HTMLElement>(".overflow-y-auto");
            const rows = [
              ...(scroller?.querySelectorAll<HTMLElement>("[data-index]") ??
                []),
            ];
            const newest = rows.sort(
              (a, b) => Number(b.dataset.index) - Number(a.dataset.index),
            )[0];
            return scroller && newest
              ? Math.round(
                  newest.getBoundingClientRect().bottom -
                    scroller.getBoundingClientRect().bottom,
                )
              : null;
          };
          const click = (testId: string) =>
            document
              .querySelector<HTMLElement>(`[data-testid="${testId}"]`)
              ?.click();
          await settle();
          const steps: Record<string, number | null> = {};
          for (let line = 2; line <= 5; line += 1) {
            click("type-line");
            await settle();
            steps[`draft ${line} lines`] = overhang();
          }
          click("send");
          await settle();
          steps.sent = overhang();
          return steps;
        });
        expect(
          Object.entries(overhangs).filter(
            ([, overhang]) => overhang === null || overhang > 0,
          ),
          JSON.stringify(overhangs),
        ).toEqual([]);
      } finally {
        await page.close();
      }
    },
    60_000,
  );
});
