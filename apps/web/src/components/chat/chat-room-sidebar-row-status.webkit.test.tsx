import { readFile } from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import { type Browser, type Page, webkit } from "playwright";
import postcss from "postcss";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SIDEBAR_ROW_LABEL_CLASS } from "@/components/ui/sidebar-classes";
import { RoomRowNameLine } from "./chat-room-sidebar-row";

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
 * A Direct row as the desktop sidebar draws it at its narrowest: 12rem (192px
 * at the default text size), a 24px leading slot, and the 16px hole the
 * focused row opens for its menu. All of it is in rem, like the sidebar, so
 * a larger text size scales the row with it.
 */
async function layout(
  name: string,
  status: string,
  { rowRem = 12, textScale = 1 } = {},
) {
  const markup = renderToStaticMarkup(
    <div
      style={{ width: `${rowRem}rem` }}
      className="flex items-center gap-2 px-2 text-sm"
    >
      <span className="size-6 shrink-0" />
      <span className={SIDEBAR_ROW_LABEL_CLASS}>
        <RoomRowNameLine
          name={
            <span data-testid="name" className="block min-w-0 truncate">
              {name}
            </span>
          }
          status={
            <span data-testid="status" className="truncate text-xs">
              {status}
            </span>
          }
        />
      </span>
      <span className="size-4 shrink-0" />
    </div>,
  );
  await page.setContent(
    `<!doctype html><html lang="de" style="font-size:${16 * textScale}px"><head><style>${css}</style></head><body>${markup}</body></html>`,
  );
  return page.evaluate(() => {
    const box = (id: string) => {
      const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
      const rect = el.getBoundingClientRect();
      return {
        right: rect.right,
        width: rect.width,
        clipped: el.scrollWidth > el.clientWidth,
      };
    };
    const label = (
      document.querySelector('[data-testid="name"]') as HTMLElement
    ).closest(".flex-1") as HTMLElement;
    const status = box("status");
    const labelRight = label.getBoundingClientRect().right;
    return {
      name: box("name"),
      status,
      // Drawn inside the row, or given up entirely.
      statusFits: status.width === 0 || status.right <= labelRight + 0.5,
    };
  });
}

describe("ChatRoomSidebarRow status in a narrow row", () => {
  it.each([
    { rowRem: 12, textScale: 1 },
    { rowRem: 12, textScale: 2 },
    { rowRem: 10, textScale: 1 },
  ])(
    "keeps the name whole and the long German status inside the row at %o",
    async (size) => {
      const result = await layout("Juno", "Konnte nicht antworten", size);

      expect(result.name.clipped).toBe(false);
      expect(result.statusFits).toBe(true);
    },
  );

  it("shortens the status, not the name, when both do not fit", async () => {
    const result = await layout("Juno", "Konnte nicht antworten", {
      rowRem: 10,
    });

    expect(result.name.clipped).toBe(false);
    expect(result.status.clipped).toBe(true);
    expect(result.statusFits).toBe(true);
  });

  it("gives a long name the row before the status", async () => {
    const result = await layout(
      "Marketing-Assistentin Juno",
      "Konnte nicht antworten",
      {},
    );

    expect(result.status.width).toBeLessThan(result.name.width);
    expect(result.statusFits).toBe(true);
  });

  it("shows a short status whole beside the name", async () => {
    const result = await layout("Juno", "Bereit");

    expect(result.name.clipped).toBe(false);
    expect(result.status.clipped).toBe(false);
  });
});
