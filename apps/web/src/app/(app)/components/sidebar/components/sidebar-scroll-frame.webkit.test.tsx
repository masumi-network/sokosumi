import { type Browser, chromium, webkit } from "playwright";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startChatRowFixtureServer } from "@/app/chat/components/__tests__/chat-row-fixture-server";

const PAGE_MODULE =
  "/src/app/(app)/components/sidebar/components/__tests__/sidebar-scroll-page.tsx";
let server: ViteDevServer;

beforeAll(async () => {
  server = await startChatRowFixtureServer({
    pageModule: PAGE_MODULE,
    html: `<!doctype html><html><head><script type="module">import "/src/app/globals.css";</script></head><body><div id="fixture"></div><script type="module" src="${PAGE_MODULE}"></script></body></html>`,
    cacheDir: ".vite-sidebar-scroll",
  });
}, 120_000);

afterAll(async () => server?.close());

describe.each([
  ["Chromium", chromium],
  ["WebKit", webkit],
])("%s sidebar scrolling", (_name, engine) => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await engine.launch();
  });
  afterAll(async () => browser?.close());

  it.each([600, 900])("keeps chrome fixed at %ipx height", async (height) => {
    const page = await browser.newPage({ viewport: { width: 1200, height } });
    try {
      await page.goto(server.resolvedUrls!.local[0]);
      const viewport = page.locator('[data-slot="scroll-area-viewport"]');
      const nav = page.getByRole("button", { name: "Navigation" });
      const footer = page.getByRole("button", { name: "Account" });
      await viewport.waitFor();
      await expect
        .poll(() =>
          page
            .locator("[data-fixed-navigation]")
            .getAttribute("data-fixed-navigation"),
        )
        .toBe("true");
      const navBefore = await nav.boundingBox();
      const footerBefore = await footer.boundingBox();
      await nav.hover();
      await page.mouse.wheel(0, 250);
      await expect
        .poll(() => viewport.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(0);
      expect(await nav.boundingBox()).toEqual(navBefore);
      expect(await footer.boundingBox()).toEqual(footerBefore);
      await page.getByRole("link", { name: "Room 49", exact: true }).focus();
      const lastRoom = await page
        .getByRole("link", { name: "Room 49", exact: true })
        .boundingBox();
      const scrollBox = await viewport.boundingBox();
      expect(lastRoom!.y).toBeGreaterThanOrEqual(scrollBox!.y);
      expect(lastRoom!.y + lastRoom!.height).toBeLessThanOrEqual(
        scrollBox!.y + scrollBox!.height + 1,
      );
      expect(await nav.boundingBox()).toEqual(navBefore);
    } finally {
      await page.close();
    }
  });

  it("uses full scrolling when chrome exceeds 55%, and responds to resizing", async () => {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 900 },
    });
    try {
      await page.goto(server.resolvedUrls!.local[0]);
      const frame = page.locator("[data-fixed-navigation]");
      const viewport = page.locator('[data-slot="scroll-area-viewport"]');
      const nav = page.getByRole("button", { name: "Navigation" });
      await expect
        .poll(() => frame.getAttribute("data-fixed-navigation"))
        .toBe("true");
      await page.setViewportSize({ width: 390, height: 400 });
      await expect
        .poll(() => frame.getAttribute("data-fixed-navigation"))
        .toBe("false");
      const before = await nav.boundingBox();
      await nav.hover();
      await page.mouse.wheel(0, 250);
      await expect
        .poll(() => frame.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(0);
      expect((await nav.boundingBox())!.y).toBeLessThan(before!.y);
      expect(await viewport.evaluate((el) => el.scrollTop)).toBe(0);
      const lastRoom = page.getByRole("link", { name: "Room 49", exact: true });
      await lastRoom.focus();
      const roomBox = await lastRoom.boundingBox();
      expect(roomBox!.y).toBeGreaterThanOrEqual(0);
      expect(roomBox!.y + roomBox!.height).toBeLessThanOrEqual(401);
      await page.setViewportSize({ width: 1200, height: 900 });
      await expect
        .poll(() => frame.getAttribute("data-fixed-navigation"))
        .toBe("true");
      expect((await nav.boundingBox())!.y).toBeGreaterThanOrEqual(0);
      // Expanded groups or larger text can exceed the cap without a window resize.
      await nav.evaluate((el) => {
        el.style.height = "700px";
      });
      await expect
        .poll(() => frame.getAttribute("data-fixed-navigation"))
        .toBe("false");
    } finally {
      await page.close();
    }
  });
});
