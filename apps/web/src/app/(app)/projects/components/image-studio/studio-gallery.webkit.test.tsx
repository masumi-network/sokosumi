import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { type Browser, chromium, type Page } from "playwright";
import postcss from "postcss";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import english from "../../../../../../messages/en.json";
import { TEST_CATALOG } from "./studio-fixtures";
import { StudioGallery } from "./studio-gallery";
import { buildStudioLabels } from "./studio-labels";
import type { StudioAsset } from "./types";

const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../../..");
const ASSETS = Array.from(
  { length: 4 },
  (_unused, index) =>
    ({
      id: `asset-${index}`,
      projectId: "project-1",
      rootId: `asset-${index}`,
      parentId: null,
      version: index + 1,
      prompt: "A square social ad",
      model: "vendor/model-a",
      width: 1024,
      height: 1024,
      bytes: 1000,
      contentType: "image/png",
      createdAt: "2026-10-02T09:00:00Z",
      jobId: `job-${index}`,
      settings: { outputFormat: "png" },
    }) as unknown as StudioAsset,
);
const ACTION_NAMES = ["Re-roll", "New variation", "Reuse prompt", "Download"];

let browser: Browser;
let css: string;
let page: Page;

beforeAll(async () => {
  const source = path.join(WEB_ROOT, "src/app/globals.css");
  css = (
    await postcss([tailwindcss()]).process(await readFile(source, "utf8"), {
      from: source,
    })
  ).css;
  browser = await chromium.launch({
    channel: existsSync(chromium.executablePath()) ? undefined : "chrome",
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
});
afterEach(async () => {
  await page?.context().close();
});

/** A phone has touch and no hover; a desktop has a mouse. */
async function showGallery(width: number, touch: boolean) {
  const context = await browser.newContext({
    hasTouch: touch,
    isMobile: touch,
    viewport: { width, height: 844 },
  });
  page = await context.newPage();
  const translate = createTranslator({
    locale: "en",
    messages: english.App.Studio,
  });
  const labels = buildStudioLabels((key) =>
    translate(key as Parameters<typeof translate>[0]),
  );
  const markup = renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={english} timeZone="UTC">
      <main className="p-3">
        <StudioGallery
          activeJobs={[]}
          assets={ASSETS}
          cancelRequestedJobIds={[]}
          catalog={TEST_CATALOG}
          labels={labels}
          onCancelJob={() => {}}
          onOpen={() => {}}
          onReroll={() => {}}
          onReusePrompt={() => {}}
          onToggleSelect={() => {}}
          onVariation={() => {}}
          queued={[]}
          selectedIds={[]}
        />
      </main>
    </NextIntlClientProvider>,
  );
  await page.setContent(
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`,
  );
}

async function visibleCount(name: string) {
  let count = 0;
  for (const control of await page
    .getByRole("button", { name, exact: true })
    .or(page.getByRole("link", { name, exact: true }))
    .all()) {
    if (await control.isVisible()) count += 1;
  }
  return count;
}

describe("Content Studio gallery tile actions", () => {
  it("shows one More button per tile, not four actions, on a 390px touch screen", async () => {
    await showGallery(390, true);
    expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(
      true,
    );

    for (const name of ACTION_NAMES) expect(await visibleCount(name)).toBe(0);
    expect(await visibleCount("More actions")).toBe(ASSETS.length);

    // The one button sits in the tile's top-right corner and covers a small
    // corner of the picture, clear of the select box on the left.
    for (const tile of await page.locator("figure").all()) {
      const box = await tile.boundingBox();
      const more = await tile
        .getByRole("button", { name: "More actions" })
        .boundingBox();
      const select = await tile
        .getByRole("button", { name: english.App.Studio.select })
        .boundingBox();
      if (!box || !more || !select) throw new Error("Tile control is hidden");
      expect(more.x + more.width).toBeLessThanOrEqual(box.x + box.width);
      expect(more.y - box.y).toBeLessThan(16);
      expect(more.x).toBeGreaterThan(select.x + select.width);
      expect(
        (more.width * more.height) / (box.width * box.height),
      ).toBeLessThan(0.08);
    }
  });

  it("keeps the four hover actions, and no More button, on a desktop with a mouse", async () => {
    await showGallery(1024, false);
    expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(
      false,
    );

    expect(await visibleCount("More actions")).toBe(0);
    const tile = page.locator("figure").first();
    const reroll = tile.getByRole("button", { name: "Re-roll" });
    expect(
      await reroll.evaluate(
        (element) => getComputedStyle(element.parentElement as Element).opacity,
      ),
    ).toBe("0");

    await tile.hover();
    await expect
      .poll(() =>
        reroll.evaluate(
          (element) =>
            getComputedStyle(element.parentElement as Element).opacity,
        ),
      )
      .toBe("1");
    for (const name of ACTION_NAMES) {
      expect(
        await tile
          .getByRole(name === "Download" ? "link" : "button", {
            name,
            exact: true,
          })
          .isVisible(),
      ).toBe(true);
    }
  });
});
