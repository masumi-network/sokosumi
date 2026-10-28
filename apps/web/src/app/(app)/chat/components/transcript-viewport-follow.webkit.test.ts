/**
 * A reader at the live edge keeps the newest message above the composer
 * while a draft grows it line by line, and after the draft is sent.
 *
 * The draft's resize reached the viewport only through the virtualizer's
 * onChange, which runs when the mounted rows change, so a growing composer
 * covered the newest message. On send the composer shrinks back, and the
 * resize was applied on top of the append's follow: the view landed the
 * composer's growth above the end, the sent message half behind it. The
 * send runs in both orders the composer and the transcript can commit in:
 * the room's, and thread-panel's, which clears before the reply appends.
 *
 * And an iPhone reader near the end keeps their distance when the composer
 * grows while the virtualizer holds a correction for a finger that is down:
 * the resize is written in the virtualizer's offsets, not the element's.
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
    browser = await engine.launch({ chromiumSandbox: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it.each([
    ["desktop", "send", { width: 1400, height: 900 }],
    ["phone", "send", { width: 402, height: 714 }],
    ["desktop", "send-then-clear", { width: 1400, height: 900 }],
    ["desktop", "clear-then-send", { width: 1400, height: 900 }],
  ])(
    "keeps the newest message above the composer while a draft grows and after it is sent (%s, %s)",
    async (_viewportName, sendTestId, viewport) => {
      const address = server.httpServer?.address();
      if (!address || typeof address === "string")
        throw new Error("Missing fixture port");
      const page = await browser.newPage({ viewport });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
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
        const overhangs = await page.evaluate(async (sendTestId) => {
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
          click(sendTestId);
          await settle();
          steps.sent = overhang();
          return steps;
        }, sendTestId);
        expect(
          Object.entries(overhangs).filter(
            ([, overhang]) => overhang === null || overhang > 0,
          ),
          JSON.stringify(overhangs),
        ).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await page.close();
      }
    },
    60_000,
  );
});

it("keeps an iPhone reader near the end at their distance when the composer grows while a correction is held", async () => {
  const address = server.httpServer?.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture port");
  const browser = await webkit.launch({ chromiumSandbox: true });
  const page = await browser.newPage({
    viewport: { width: 402, height: 714 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
    await page.waitForFunction(() => document.body.dataset.atEnd === "true");
    const distance = await page.evaluate(async () => {
      const frames = async (count: number) => {
        for (let frame = 0; frame < count; frame += 1)
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => setTimeout(resolve, 0)),
          );
      };
      const scroller = document.querySelector<HTMLElement>(".overflow-y-auto");
      if (!scroller) return null;
      const fromEnd = () =>
        scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      const click = (testId: string) =>
        document
          .querySelector<HTMLElement>(`[data-testid="${testId}"]`)
          ?.click();
      await frames(6);
      scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight - 100;
      await frames(6);
      // A finger is down: the virtualizer holds corrections until it lifts.
      scroller.dispatchEvent(new TouchEvent("touchstart"));
      click("grow-older");
      await frames(6);
      click("type-line");
      await frames(6);
      scroller.dispatchEvent(new TouchEvent("touchend"));
      // Past TanStack's post-touch grace, then the flush.
      await new Promise((resolve) => setTimeout(resolve, 600));
      await frames(6);
      return Math.round(fromEnd());
    });
    expect(distance).toBe(100);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await browser.close();
  }
}, 60_000);
