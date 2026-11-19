import { readFile } from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import { type Browser, type Page, webkit } from "playwright";
import postcss from "postcss";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Markdown from "./markdown";

const WEB_ROOT = path.resolve(import.meta.dirname, "../..");
const COLUMNS = 10;
const url = (n: number) =>
  `www.travelling-dippegucker.de/segeln-auf-der-ostsee-${n}-wie-sieht-es-aus-das-richtige-boot/`;
// An SEO report row: long scheme-less URLs beside short numbers and prose.
const cells = (n: number) => [
  String(n),
  url(n),
  "segeln ostsee boot",
  "4.4",
  "12",
  "340",
  "2.1%",
  url(n + 10),
  "Title misses the main keyword and the meta description is too long",
  "Rewrite the title",
];
const row = (values: string[]) => `| ${values.join(" | ")} |`;
const TABLE = [
  row(Array.from({ length: COLUMNS }, (_, i) => `Column ${i + 1}`)),
  row(Array.from({ length: COLUMNS }, () => "---")),
  row(cells(1)),
  row(cells(2)),
].join("\n");

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

describe("Markdown table layout", () => {
  it.each([390, 1280])(
    "scrolls a wide table inside its frame at %i px",
    async (width) => {
      await page.setViewportSize({ width, height: 900 });
      const markup = renderToStaticMarkup(
        <div className="mx-auto flex max-w-3xl p-4">
          <div className="min-w-0 flex-1">
            <Markdown>{`Intro prose.\n\n${TABLE}`}</Markdown>
          </div>
        </div>,
      );
      await page.setContent(
        `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`,
      );
      const layout = await page.evaluate(() => {
        const table = document.querySelector("table");
        const frame = table?.parentElement;
        const lineHeight = Number.parseFloat(
          getComputedStyle(document.querySelector("td") as Element).lineHeight,
        );
        return {
          frameClient: frame?.clientWidth ?? 0,
          frameScroll: frame?.scrollWidth ?? 0,
          tallestCellLines:
            Math.max(
              ...[...document.querySelectorAll("td")].map(
                (cell) => cell.getBoundingClientRect().height,
              ),
            ) / lineHeight,
          pageClient: document.documentElement.clientWidth,
          pageScroll: document.documentElement.scrollWidth,
        };
      });

      expect(layout.frameScroll).toBeGreaterThan(layout.frameClient);
      expect(layout.pageScroll).toBeLessThanOrEqual(layout.pageClient);
      // Squished columns stacked a URL over 20 lines; capped cells wrap to a few.
      expect(layout.tallestCellLines).toBeLessThan(5);
    },
  );
});
