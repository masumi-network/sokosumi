/**
 * Real-layout chat viewport regressions: Seen by overhang, older history,
 * streaming growth and measured position restoration.
 *
 * The overhang regression is SOKOSUMI-SF / SOKOSUMI-SE, "Maximum update depth
 * exceeded" on a phone, thrown from the viewport's scroll-margin effect.
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
import { type Browser, type Page, webkit } from "playwright";
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

async function behaviorPage(): Promise<Page> {
  const address = server.httpServer?.address();
  if (!address || typeof address === "string")
    throw new Error("the page server has no port");
  const page = await browser.newPage({
    viewport: PHONE_VIEWPORT,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  });
  await page.goto(`http://127.0.0.1:${address.port}/?behavior`);
  await page.waitForFunction(() => {
    const element = document.querySelector<HTMLElement>(".overflow-y-auto");
    return (
      element &&
      document.querySelector('[data-message-id="msg-039"]') &&
      element.scrollHeight - element.clientHeight - element.scrollTop < 1
    );
  });
  return page;
}

async function rowTop(page: Page, id: string): Promise<number> {
  return page.evaluate((id) => {
    const row = document.querySelector<HTMLElement>(
      `[data-message-id="${id}"]`,
    );
    const scroller = document.querySelector<HTMLElement>(".overflow-y-auto");
    return row && scroller
      ? row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      : Infinity;
  }, id);
}

async function distanceFromEnd(page: Page): Promise<number> {
  return page
    .locator(".overflow-y-auto")
    .evaluate((element) =>
      getComputedStyle(element).flexDirection === "column-reverse"
        ? -element.scrollTop
        : element.scrollHeight - element.clientHeight - element.scrollTop,
    );
}

async function scrollToOffset(page: Page, offset: number) {
  await page.locator(".overflow-y-auto").evaluate(async (element, offset) => {
    element.scrollTop = offset;
    // Native scroll observation and the virtual range update happen after the write.
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  }, offset);
}

it("preserves the reading row when an older page replaces its loading boundary", async () => {
  const page = await behaviorPage();
  try {
    await scrollToOffset(page, 0);
    await expect.poll(() => rowTop(page, "msg-000")).toBeLessThan(100);
    const before = await rowTop(page, "msg-000");
    await page.getByTestId("load-older").click();
    await expect
      .poll(() => page.locator("nav").getAttribute("data-row-count"))
      .toBe("70");
    await expect
      .poll(() => page.getByText("Message -1", { exact: true }).count())
      .toBe(1);
    await expect.poll(() => rowTop(page, "msg-000")).toBeCloseTo(before, 0);
    await expect.poll(() => page.getByTestId("load-older").count()).toBe(0);
  } finally {
    await page.close();
  }
});

it("follows streaming growth at the live edge", async () => {
  const page = await behaviorPage();
  try {
    const before = await page
      .locator(".overflow-y-auto")
      .evaluate((element) => element.scrollHeight);
    await page.getByTestId("stream").click();
    await expect
      .poll(() =>
        page
          .locator(".overflow-y-auto")
          .evaluate((element) => element.scrollHeight),
      )
      .toBeGreaterThan(before + 300);
    await expect.poll(() => distanceFromEnd(page)).toBeLessThan(1);
    expect(
      await page.locator('[data-message-id="msg-039"]').innerText(),
    ).toContain("Streaming line");
  } finally {
    await page.close();
  }
});

it("preserves a surviving message when history prepends", async () => {
  const page = await behaviorPage();
  try {
    await scrollToOffset(page, 420);
    await expect.poll(() => rowTop(page, "msg-010")).toBeLessThan(200);
    const before = await rowTop(page, "msg-010");
    await page.getByTestId("prepend").click();
    await expect
      .poll(() => page.locator("nav").getAttribute("data-row-count"))
      .toBe("70");
    await expect
      .poll(() => page.getByText("Message -1", { exact: true }).count())
      .toBe(1);
    await expect.poll(() => rowTop(page, "msg-010")).toBeCloseTo(before, 0);
  } finally {
    await page.close();
  }
});

it("keeps the reading row in place when older history arrives during an iOS touch", async () => {
  // A page can finish while the finger is still down. Both the live gesture
  // and the settled insertion must retain the reading row. This simulates
  // touch state, not physical device inertia.
  const page = await behaviorPage();
  try {
    const scroller = page.locator(".overflow-y-auto");
    await scrollToOffset(page, 420);
    await expect.poll(() => rowTop(page, "msg-010")).toBeLessThan(200);
    const before = await rowTop(page, "msg-010");
    await scroller.evaluate((element) =>
      element.dispatchEvent(new TouchEvent("touchstart")),
    );
    await page.getByTestId("prepend").click();
    await expect
      .poll(() => page.locator("nav").getAttribute("data-row-count"))
      .toBe("70");
    await expect.poll(() => rowTop(page, "msg-010")).toBeCloseTo(before, 0);
    expect(await page.getByText("Message -1", { exact: true }).count()).toBe(0);
    await scroller.evaluate((element) =>
      element.dispatchEvent(new TouchEvent("touchend")),
    );
    await expect
      .poll(() => page.getByText("Message -1", { exact: true }).count())
      .toBe(1);
    await expect.poll(() => rowTop(page, "msg-010")).toBeCloseTo(before, 0);
    await page.getByTestId("restore").click();
    await expect
      .poll(() => page.locator("nav").getAttribute("data-generation"))
      .toBe("1");
    await expect.poll(() => rowTop(page, "msg-010")).toBeCloseTo(before, 0);
  } finally {
    await page.close();
  }
});

it("keeps history in place during streaming and restores its measured position on remount", async () => {
  const page = await behaviorPage();
  try {
    await scrollToOffset(page, 420);
    await expect.poll(() => rowTop(page, "msg-010")).toBeLessThan(200);
    const before = await rowTop(page, "msg-010");
    await page.getByTestId("stream").click();
    await expect
      .poll(() => page.locator("nav").getAttribute("data-streaming"))
      .toBe("true");
    await expect.poll(() => rowTop(page, "msg-010")).toBeCloseTo(before, 0);
    await page.getByTestId("restore").click();
    await expect
      .poll(() => page.locator("nav").getAttribute("data-generation"))
      .toBe("1");
    await expect.poll(() => rowTop(page, "msg-010")).toBeCloseTo(before, 0);
  } finally {
    await page.close();
  }
});

it("keeps streaming responsive when older history arrives during a touch", async () => {
  const page = await behaviorPage();
  try {
    const scroller = page.locator(".overflow-y-auto");
    const heightBefore = await scroller.evaluate(
      (element) => element.scrollHeight,
    );
    await scroller.evaluate((element) =>
      element.dispatchEvent(new TouchEvent("touchstart")),
    );
    await page.getByTestId("prepend").click();
    await expect
      .poll(() => page.locator("nav").getAttribute("data-row-count"))
      .toBe("70");
    await page.getByTestId("stream").click();
    await expect
      .poll(() => page.locator('[data-message-id="msg-039"]').innerText())
      .toContain("Streaming line");
    await scroller.evaluate((element) =>
      element.dispatchEvent(new TouchEvent("touchend")),
    );
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollHeight))
      .toBeGreaterThan(heightBefore + 1000);
    await expect.poll(() => distanceFromEnd(page)).toBeLessThan(1);
  } finally {
    await page.close();
  }
});

it("keeps following latest when streaming resumes after a cancelled touch", async () => {
  const page = await behaviorPage();
  try {
    const scroller = page.locator(".overflow-y-auto");
    const heightBefore = await scroller.evaluate(
      (element) => element.scrollHeight,
    );
    await scroller.evaluate((element) => {
      element.dispatchEvent(new TouchEvent("touchstart"));
      element.dispatchEvent(new TouchEvent("touchcancel"));
    });
    await page.getByTestId("stream").click();
    await expect
      .poll(() => page.locator('[data-message-id="msg-039"]').innerText())
      .toContain("Streaming line");
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollHeight))
      .toBeGreaterThan(heightBefore + 300);
    await expect.poll(() => distanceFromEnd(page)).toBeLessThan(1);
  } finally {
    await page.close();
  }
});

it("waits for scrolling to settle after touch release before inserting older rows", async () => {
  const page = await behaviorPage();
  try {
    const scroller = page.locator(".overflow-y-auto");
    expect(
      await scroller.evaluate(
        (element) => getComputedStyle(element).flexDirection,
      ),
    ).toBe("column");
    await scrollToOffset(page, 420);
    await expect.poll(() => rowTop(page, "msg-010")).toBeLessThan(200);
    await scroller.evaluate((element) =>
      element.dispatchEvent(new TouchEvent("touchstart")),
    );
    await page.getByTestId("prepend").click();
    await expect
      .poll(() => page.locator("nav").getAttribute("data-row-count"))
      .toBe("70");
    // Continued native offset changes after release stand in for deceleration.
    await scroller.evaluate(async (element) => {
      element.dispatchEvent(new TouchEvent("touchend"));
      for (let frame = 0; frame < 8; frame += 1) {
        element.scrollTop += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    });
    expect(await page.getByText("Message -1", { exact: true }).count()).toBe(0);
    const before = await rowTop(page, "msg-010");
    await expect
      .poll(() => page.getByText("Message -1", { exact: true }).count())
      .toBe(1);
    await expect.poll(() => rowTop(page, "msg-010")).toBeCloseTo(before, 0);
  } finally {
    await page.close();
  }
});
