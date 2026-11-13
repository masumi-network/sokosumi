import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SocialPostMediaRef } from "@sokosumi/core-client";
import tailwindcss from "@tailwindcss/postcss";
import { NextIntlClientProvider } from "next-intl";
import { type Browser, type Page, webkit } from "playwright";
import postcss from "postcss";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import messages from "../../../../../../messages/en.json";
import { SocialPostPreview } from "./social-post-preview";

const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../../..");
const ACCOUNT = { handle: "masumi", displayName: "Masumi", avatarUrl: null };
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
}, 60_000);

afterAll(async () => {
  await browser?.close();
});
beforeEach(async () => {
  page = await browser.newPage();
  await page.route(/^https?:/, (route) => route.abort());
});
afterEach(async () => {
  await page?.close();
});

describe("Social post image layout", () => {
  it.each(
    [390, 1440].flatMap((width) =>
      (["x", "instagram"] as const).flatMap((provider) =>
        [
          { label: "wide", imageWidth: 1600, imageHeight: 900 },
          { label: "tall", imageWidth: 900, imageHeight: 1600 },
        ].map((image) => ({ width, provider, ...image })),
      ),
    ),
  )(
    "shows the complete $label image in the $provider card at $width px",
    async ({ width, provider, imageWidth, imageHeight, label }) => {
      await page.setViewportSize({ width, height: 1200 });
      const media: SocialPostMediaRef = {
        pathname: `fixture/${label}.svg`,
        fileUrl: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}"><rect width="100%" height="100%" fill="#ddd"/></svg>`)}`,
        name: `${label} image`,
        size: 100,
        mimeType: "image/svg+xml",
        kind: "image",
      };
      const markup = renderToStaticMarkup(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <div className="bg-card-background p-4">
            <SocialPostPreview
              account={ACCOUNT}
              className="max-w-xl"
              compact
              media={[media]}
              provider={provider}
              text="Launch post"
              timestamp={null}
            />
          </div>
        </NextIntlClientProvider>,
      );
      await page.setContent(
        `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`,
      );
      const image = page.getByRole("img", { name: media.name });
      await page.waitForFunction(() =>
        [...document.images].every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      );
      const rendered = await image.evaluate((element: HTMLImageElement) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const scale = Math.min(
          box.width / element.naturalWidth,
          box.height / element.naturalHeight,
        );
        return {
          fit: style.objectFit,
          width: box.width,
          height: box.height,
          contentWidth: element.naturalWidth * scale,
          contentHeight: element.naturalHeight * scale,
          naturalWidth: element.naturalWidth,
          naturalHeight: element.naturalHeight,
          right: box.right,
          left: box.left,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });

      expect(rendered.fit).toBe("contain");
      expect(rendered.naturalWidth).toBe(imageWidth);
      expect(rendered.naturalHeight).toBe(imageHeight);
      expect(rendered.width).toBeGreaterThan(0);
      expect(rendered.height).toBeGreaterThan(0);
      expect(rendered.contentWidth).toBeLessThanOrEqual(rendered.width + 0.01);
      expect(rendered.contentHeight).toBeLessThanOrEqual(
        rendered.height + 0.01,
      );
      expect(rendered.contentWidth / rendered.contentHeight).toBeCloseTo(
        imageWidth / imageHeight,
      );
      expect(rendered.left).toBeGreaterThanOrEqual(0);
      expect(rendered.right).toBeLessThanOrEqual(width);
      expect(rendered.scrollWidth).toBe(width);
    },
  );
});
