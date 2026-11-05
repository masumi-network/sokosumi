/**
 * A collapsed message body caps at 16 body lines and offers Show more, whatever
 * it holds. `line-clamp` counted only lines in the body's own flow, so tables
 * and code blocks (sideways scrollers) ran at full height with no Show more.
 * A large picture alone, or under a one-line caption, still fits the cap.
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
/** Serves the fixture page's picture links (`CLAMP_IMAGE_URL`). */
const CLAMP_IMAGE_HOST = "image-fixture.invalid";
/** Portrait, so at any width it renders at the large preview's `max-h-80`. */
const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1440"><rect width="960" height="1440" fill="black"/></svg>`;

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

  /** The fixture page, rendered, with the fixture picture served offline. */
  async function openClampPage() {
    const address = server.httpServer?.address();
    if (!address || typeof address === "string")
      throw new Error("Missing fixture port");
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === CLAMP_IMAGE_HOST)
        return route.fulfill({ contentType: "image/svg+xml", body: PICTURE });
      if (url.hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForFunction(
      () => getComputedStyle(document.body).margin === "0px",
    );
    await page.addScriptTag({
      type: "module",
      content: `const { renderClampPage } = await import(${JSON.stringify(PAGE_MODULE)});
        renderClampPage();`,
    });
    return { page, errors };
  }

  it.each([
    ["paragraphs", "room-message-body"],
    ["table", "room-message-body"],
    ["code", "room-message-body"],
    ["image", "room-message-body"],
    ["brief", "soko-bot-brief-body"],
  ])(
    "collapses a long %s body behind Show more",
    async (kind, bodyTestId) => {
      const { page, errors } = await openClampPage();
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
  it.each(["photo", "captioned"])(
    "shows a %s body in full, with no Show more",
    async (kind) => {
      const { page, errors } = await openClampPage();
      const row = page.locator(`[data-row="${kind}"]`);
      const body = row.getByTestId("room-message-body");
      await body.waitFor();
      await page.waitForFunction((selector) => {
        const image = document.querySelector<HTMLImageElement>(selector);
        return image?.complete && image.naturalWidth > 0;
      }, `[data-row="${kind}"] img`);
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );

      const { pictureHeight, capHeight, clipped } = await body.evaluate(
        (node) => ({
          pictureHeight: node.querySelector("img")!.getBoundingClientRect()
            .height,
          // `max-h-80` is 20rem; WebKit's root follows the system text size.
          capHeight:
            20 *
            Number.parseFloat(
              getComputedStyle(document.documentElement).fontSize,
            ),
          clipped: node.scrollHeight > node.clientHeight + 1,
        }),
      );
      // The picture sits flush with the body's clipped edge, so its focus
      // indicator has to be drawn inside the button to stay visible.
      const imageButton = row.locator("button:has(img)");
      await imageButton.focus();
      const focus = await imageButton.evaluate((button) => {
        const style = getComputedStyle(button);
        return {
          visible: button.matches(":focus-visible"),
          style: style.outlineStyle,
          inset:
            Number.parseFloat(style.outlineOffset) +
            Number.parseFloat(style.outlineWidth),
        };
      });
      expect(focus).toEqual({ visible: true, style: "solid", inset: 0 });
      // The worst case: the picture at the large preview's full height.
      expect(pictureHeight).toBeGreaterThan(capHeight - 20);
      expect(clipped).toBe(false);
      expect(await row.getByRole("button", { name: "Show more" }).count()).toBe(
        0,
      );
      expect(errors).toEqual([]);
      await page.close();
    },
    60_000,
  );
});
