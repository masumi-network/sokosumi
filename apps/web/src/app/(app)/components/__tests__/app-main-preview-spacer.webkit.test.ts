/**
 * On a Vercel preview, `main[data-app-main]::after` adds room to scroll past
 * the injected toolbar (`globals.css`). In WebKit the inner wrapper stops at
 * the main's height, so a long page overflows it and its rows sit over that
 * spacer. WebKit hit-tests the spacer as `main`, so a tap there missed the row
 * (You → Contacts and Files on an iPhone). Real WebKit touch, as on iOS.
 * Run with `pnpm --filter web test:webkit` (WebKit installed).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import tailwindcss from "@tailwindcss/postcss";
import { type Browser, devices, type Page, webkit } from "playwright";
import postcss from "postcss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  APP_MAIN_MOBILE_PT_CLASS,
  APP_SHELL_BELOW_HEADER_MD_MAX_HEIGHT_CLASS,
  APP_SHELL_BELOW_HEADER_MD_MIN_HEIGHT_CLASS,
} from "@/app/components/app-shell-safe-area";

const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../..");

/** The You page's rows, in its order. */
const ROWS = [
  "Credit history",
  "Agents",
  "Schedules",
  "Calendar",
  "Content Studio",
  "TikTok Studio",
  "Social posts",
  "SEO",
  "Ads",
  "Contacts",
  "Files",
  "Account",
  "Notification settings",
  "Billing",
  "Connections",
  "Developer",
  "Help",
  "Legal",
];

let browser: Browser;
let page: Page;
let css: string;

beforeAll(async () => {
  const source = path.join(WEB_ROOT, "src/app/globals.css");
  css = (
    await postcss([tailwindcss()]).process(await readFile(source, "utf8"), {
      from: source,
    })
  ).css;
  browser = await webkit.launch();
  page = await (
    await browser.newContext({ ...devices["iPhone 15"] })
  ).newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

describe("Preview toolbar spacer (WebKit touch)", () => {
  it("lets a tap reach every row of a page longer than the screen", async () => {
    const rows = ROWS.map(
      (label) =>
        `<a href="#${encodeURIComponent(label)}" class="flex h-11 items-center px-3">${label}</a>`,
    ).join("");
    await page.setContent(`<!doctype html><html lang="en"><head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>${css}</style></head><body>
      <main data-app-main class="app-scrollbar relative flex max-h-dvh min-h-dvh flex-1 flex-col overflow-x-hidden overflow-y-auto p-4 [scrollbar-gutter:stable] md:pt-4 ${APP_MAIN_MOBILE_PT_CLASS} ${APP_SHELL_BELOW_HEADER_MD_MIN_HEIGHT_CLASS} ${APP_SHELL_BELOW_HEADER_MD_MAX_HEIGHT_CLASS}">
        <div data-app-main-inner class="flex min-h-full flex-1 flex-col overflow-visible">
          <div class="flex min-h-full flex-1 flex-col">
            <div class="flex flex-1 flex-col">
              <div class="w-full pb-6">
                <div class="h-72">You header and credits</div>
                <nav class="border-border divide-border divide-y overflow-hidden rounded-lg border">${rows}</nav>
              </div>
            </div>
            <div class="pointer-events-none shrink-0 h-[calc(4rem+max(0.75rem,env(safe-area-inset-bottom)))]"></div>
          </div>
        </div>
      </main>
      </body></html>`);
    // Vercel's script adds its toolbar once the page has rendered.
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        "beforeend",
        "<vercel-live-feedback></vercel-live-feedback>",
      );
    });

    // The spacer is where the bug lives: some row must overlap it.
    const overlapping = await page.evaluate(() => {
      const main = document.querySelector("main") as HTMLElement;
      const inner = main.firstElementChild as HTMLElement;
      const top = inner.offsetTop + inner.offsetHeight;
      const bottom =
        top + Number.parseFloat(getComputedStyle(main, "::after").height);
      return [...main.querySelectorAll("a")]
        .filter(
          (a) => a.offsetTop + a.offsetHeight > top && a.offsetTop < bottom,
        )
        .map((a) => a.textContent);
    });
    expect(overlapping.length).toBeGreaterThan(0);

    for (const label of ROWS) {
      const row = page.getByRole("link", { name: label, exact: true });
      await row.evaluate((element) =>
        element.scrollIntoView({ block: "center" }),
      );
      const box = await row.boundingBox();
      if (!box) throw new Error(`${label} is hidden`);
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      expect(
        decodeURIComponent(await page.evaluate(() => location.hash.slice(1))),
        `tap on ${label} (overlapping the spacer: ${overlapping.join(", ")})`,
      ).toBe(label);
    }
  });
});
