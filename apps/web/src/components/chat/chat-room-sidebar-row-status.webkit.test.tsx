import { readFile } from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import { type Browser, type Page, webkit } from "playwright";
import postcss from "postcss";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SIDEBAR_ROW_LABEL_CLASS } from "@/components/ui/sidebar-classes";
import { RoomRowNameLine, RoomRowStatusReveal } from "./chat-room-sidebar-row";

const WEB_ROOT = path.resolve(import.meta.dirname, "../../..");

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
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

/**
 * A Direct row as the desktop sidebar draws it at its narrowest: 192px, a
 * 24px leading slot, the room link, and the menu the focused row shows at its
 * end. `rowRem` sizes the row in rem, as the default sidebar is, so a larger
 * text size widens it; `rowPx` fixes it in pixels, as a sidebar the reader
 * resized is stored, so a larger text size does not.
 */
async function layout(
  name: string,
  status: string,
  {
    rowRem = 12,
    rowPx,
    textScale = 1,
  }: { rowRem?: number; rowPx?: number; textScale?: number } = {},
) {
  const statusNode = (
    <span className="truncate text-xs" data-status>
      {status}
    </span>
  );
  const markup = renderToStaticMarkup(
    <div style={{ width: rowPx ? `${rowPx}px` : `${rowRem}rem` }}>
      <div className="group/room-row relative">
        <a
          href="#juno"
          data-testid="link"
          className="flex h-7 items-center gap-2 px-2 text-sm"
        >
          <span className="size-6 shrink-0" />
          <span className={SIDEBAR_ROW_LABEL_CLASS}>
            <RoomRowNameLine
              name={
                <span data-testid="name" className="block min-w-0 truncate">
                  {name}
                </span>
              }
              status={statusNode}
            />
          </span>
          {/* The hole a focused row opens for its menu. */}
          <span className="size-4 shrink-0 group-focus-within/room-row:size-4" />
        </a>
        <button
          type="button"
          data-testid="menu"
          className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
        >
          …
        </button>
        <RoomRowStatusReveal status={statusNode} />
      </div>
      <a href="#next" data-testid="next">
        Next
      </a>
    </div>,
  );
  await page.setContent(
    `<!doctype html><html lang="de" style="font-size:${16 * textScale}px"><head><style>${css}</style></head><body>${markup}</body></html>`,
  );
  const measure = () =>
    page.evaluate(() => {
      const el = (selector: string) =>
        document.querySelector(selector) as HTMLElement;
      const box = (target: HTMLElement) => {
        const rect = target.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          clipped: target.scrollWidth > target.clientWidth,
          shown: getComputedStyle(target).display !== "none",
        };
      };
      const label = el('[data-testid="name"]').closest(
        ".flex-1",
      ) as HTMLElement;
      const lineStatus = el('[data-testid="link"] [data-status]');
      const reveal = el('[data-slot="room-status-reveal"]');
      const status = box(lineStatus);
      const labelRight = label.getBoundingClientRect().right;
      return {
        row: box(el('[data-testid="link"]')),
        name: box(el('[data-testid="name"]')),
        status,
        // Drawn inside the row, or given up entirely.
        statusFits: status.width === 0 || status.right <= labelRight + 0.5,
        menu: box(el('[data-testid="menu"]')),
        reveal: box(reveal),
        revealText: reveal.textContent,
        revealStatusClipped:
          (reveal.firstElementChild as HTMLElement).scrollWidth >
          (reveal.firstElementChild as HTMLElement).clientWidth,
        focused: document.activeElement?.getAttribute("data-testid"),
      };
    });
  const atRest = await measure();
  // Keyboard focus, so `:focus-visible` matches as it does for a reader.
  // WebKit's Tab skips links (Safari's default), so a key press marks the
  // focus as the keyboard's and the link is focused straight after.
  await page.keyboard.press("Shift");
  await page.focus('[data-testid="link"]');
  const focused = await measure();
  return { atRest, focused };
}

describe("ChatRoomSidebarRow status in a narrow row", () => {
  it.each([
    { rowRem: 12, textScale: 1 },
    { rowRem: 12, textScale: 2 },
    { rowRem: 10, textScale: 1 },
    { rowPx: 192, textScale: 1.5 },
  ])(
    "keeps the name whole and the long German status inside the row at %o",
    async (size) => {
      const { atRest, focused } = await layout(
        "Juno",
        "Konnte nicht antworten",
        size,
      );

      for (const state of [atRest, focused]) {
        expect(state.name.clipped).toBe(false);
        expect(state.statusFits).toBe(true);
      }
    },
  );

  it("shortens the status, not the name, when both do not fit", async () => {
    const { focused } = await layout("Juno", "Konnte nicht antworten", {
      rowRem: 10,
    });

    expect(focused.name.clipped).toBe(false);
    expect(focused.status.clipped).toBe(true);
    expect(focused.statusFits).toBe(true);
  });

  it("gives a long name the row before the status", async () => {
    const { atRest } = await layout(
      "Marketing-Assistentin Juno",
      "Konnte nicht antworten",
    );

    expect(atRest.status.width).toBeLessThan(atRest.name.width);
    expect(atRest.statusFits).toBe(true);
  });

  it("shows a short status whole beside the name", async () => {
    const { atRest } = await layout("Juno", "Bereit");

    expect(atRest.name.clipped).toBe(false);
    expect(atRest.status.clipped).toBe(false);
  });

  // A sidebar the reader resized keeps its width in pixels, so larger text
  // gets no more room: the status the line drops is read under the row.
  it.each([
    { rowPx: 192, textScale: 1 },
    { rowPx: 192, textScale: 1.5 },
    { rowPx: 192, textScale: 2 },
  ])(
    "shows the full status under the row on keyboard focus at %o",
    async (size) => {
      const { atRest, focused } = await layout(
        "Juno",
        "Konnte nicht antworten",
        size,
      );

      expect(atRest.reveal.shown).toBe(false);
      expect(focused.focused).toBe("link");
      expect(focused.reveal.shown).toBe(true);
      expect(focused.revealText).toBe("Konnte nicht antworten");
      expect(focused.revealStatusClipped).toBe(false);
      // Under the row, inside its width, clear of the name and the menu.
      expect(focused.reveal.top).toBeGreaterThanOrEqual(focused.row.bottom);
      expect(focused.reveal.top).toBeGreaterThanOrEqual(focused.menu.bottom);
      expect(focused.reveal.left).toBeGreaterThanOrEqual(focused.row.left);
      expect(focused.reveal.right).toBeLessThanOrEqual(focused.row.right);
      expect(focused.statusFits).toBe(true);
    },
  );

  it("puts the reveal away once focus moves on", async () => {
    await layout("Juno", "Konnte nicht antworten", { rowPx: 192 });
    await page.keyboard.press("Shift");
    await page.focus('[data-testid="next"]');

    const shown = await page.evaluate(
      () =>
        getComputedStyle(
          document.querySelector(
            '[data-slot="room-status-reveal"]',
          ) as HTMLElement,
        ).display !== "none",
    );
    expect(shown).toBe(false);
  });
});
