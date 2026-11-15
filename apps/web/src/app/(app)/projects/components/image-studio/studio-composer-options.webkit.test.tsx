import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { type BrowserContext, chromium, type Page } from "playwright";
import postcss from "postcss";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import german from "../../../../../../messages/de.json";
import english from "../../../../../../messages/en.json";
import { StudioComposer } from "./studio-composer";
import { TEST_CATALOG } from "./studio-fixtures";
import { buildStudioLabels } from "./studio-labels";
import type { StudioCatalog } from "./types";

vi.mock("@/lib/auth/auth.client", () => ({ authClient: {} }));
vi.mock("./studio-approved-headlines", () => ({
  readApprovedStudioHeadlines: vi.fn(),
}));
// Static markup has no open Radix popover, so each popover's content renders
// in place with the shell classes of `PopoverContent`. `showOptions` then lifts
// the Options one above its trigger, where Radix would put it.
vi.mock("@/components/ui/popover", async () => {
  const { cn } = await import("@/lib/utils");
  const Passthrough = ({ children }: { children: ReactNode }) => children;
  return {
    Popover: Passthrough,
    PopoverTrigger: Passthrough,
    PopoverContent: ({
      children,
      className,
    }: {
      children: ReactNode;
      className?: string;
    }) => (
      <div
        className={cn(
          "bg-popover text-popover-foreground z-50 w-72 rounded-md border p-4 shadow-md",
          className,
        )}
        data-slot="popover-content"
      >
        {children}
      </div>
    ),
  };
});

const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../../..");
const [imageModel] = TEST_CATALOG.models;
// Six models as production lists them: four write png, two pick their own
// format, so every model shares the frame and only the format differs.
const catalog: StudioCatalog = {
  ...TEST_CATALOG,
  models: [
    "Meta Muse Image",
    "Gemini 3.1 Flash Image",
    "Gemini 3 Pro Image",
    "FLUX.2 Pro",
    "Ideogram Text to Image",
    "Recraft V3",
  ].map((label, index) => ({
    ...imageModel,
    id: `options-model-${index}`,
    label,
    outputFormats: index < 4 ? imageModel.outputFormats : [],
  })),
};

let context: BrowserContext;
let page: Page;
let profile: string;
let css: string;

beforeAll(async () => {
  const source = path.join(WEB_ROOT, "src/app/globals.css");
  css = (
    await postcss([tailwindcss()]).process(await readFile(source, "utf8"), {
      from: source,
    })
  ).css;
  profile = await mkdtemp(path.join(WEB_ROOT, "node_modules/.studio-options-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: existsSync(chromium.executablePath()) ? undefined : "chrome",
    chromiumSandbox: true,
  });
}, 60_000);

afterAll(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});
beforeEach(async () => {
  page = await context.newPage();
});
afterEach(async () => {
  await page?.close();
});

/**
 * The composer sits where production puts it, part-way down the page, and the
 * Options popover opens above its trigger with only the room left above it.
 */
async function showOptions(width: number, locale: "en" | "de" = "en") {
  const messages = locale === "de" ? german : english;
  const translate = createTranslator({ locale, messages: messages.App.Studio });
  const labels = buildStudioLabels((key) =>
    translate(key as Parameters<typeof translate>[0]),
  );
  const height = width < 768 ? 844 : 768;
  await page.setViewportSize({ width, height });
  const markup = renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <main className="p-4" style={{ paddingTop: height / 2 }}>
        <div className="mx-auto w-full max-w-3xl">
          <StudioComposer
            busy={false}
            catalog={catalog}
            labels={labels}
            onApplyTemplate={() => {}}
            onClearReferences={() => {}}
            onGenerate={() => {}}
            onPhotoUploadChange={() => {}}
            onPromptChange={() => {}}
            onTargetChange={() => {}}
            prompt=""
            referenceAssets={[]}
            target={{
              modelIds: catalog.models.map(({ id }) => id),
              settings: {
                aspectRatio: "1:1",
                resolution: "1K",
                outputFormat: "png",
                seed: null,
              },
            }}
          />
        </div>
      </main>
    </NextIntlClientProvider>,
  );
  await page.setContent(
    `<!doctype html><html lang="${locale}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`,
  );
  const creativeDirection = messages.App.Studio.creativeDirection;
  await page.evaluate((heading) => {
    const contents = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-slot="popover-content"]',
      ),
    ];
    const options = contents.find((content) =>
      content.textContent?.startsWith(heading),
    );
    if (!options) throw new Error("Options popover did not render");
    for (const content of contents) if (content !== options) content.remove();
    const trigger = options.previousElementSibling;
    if (!trigger) throw new Error("Options trigger did not render");
    options.style.position = "fixed";
    document.body.append(options);
    const anchor = trigger.getBoundingClientRect();
    const gap = 4;
    options.style.setProperty(
      "--radix-popover-content-available-height",
      `${anchor.top - gap}px`,
    );
    options.style.left = `${Math.max(
      0,
      Math.min(anchor.left, window.innerWidth - options.offsetWidth),
    )}px`;
    options.style.top = `${anchor.top - gap - options.offsetHeight}px`;
  }, creativeDirection);
  return page.locator('[data-slot="popover-content"]');
}

describe("Content Studio Options popover", () => {
  it.each([390, 1024])(
    "states the shared size once and keeps placements in view at %ipx",
    async (width) => {
      const options = await showOptions(width);
      const studio = english.App.Studio;

      // One shared line, then only the two models whose format differs.
      expect(
        await options.getByText(`${studio.dimensions}: 1:1 · 1K · png`).count(),
      ).toBe(1);
      expect(await options.getByRole("listitem").allTextContents()).toEqual([
        `Ideogram Text to Image · 1:1 · 1K · ${studio.modelChoosesFormat}`,
        `Recraft V3 · 1:1 · 1K · ${studio.modelChoosesFormat}`,
      ]);

      // Placements sit inside the opened popover, not below its fold.
      const box = await options.boundingBox();
      const placements = await options
        .getByText(studio.adPlacements, { exact: true })
        .boundingBox();
      if (!box || !placements) throw new Error("Popover is hidden");
      expect(placements.y + placements.height).toBeLessThanOrEqual(
        box.y + box.height,
      );
    },
  );

  it.each(["en", "de"] as const)(
    "keeps each option label on one line at 390px in %s",
    async (locale) => {
      const options = await showOptions(390, locale);
      const studio = (locale === "de" ? german : english).App.Studio;
      for (const label of [studio.creativeDirection, studio.adPlacements]) {
        const lines = await options
          .getByText(label, { exact: true })
          .evaluate(
            (element) =>
              element.getBoundingClientRect().height /
              Number.parseFloat(getComputedStyle(element).lineHeight),
          );
        expect(Math.round(lines)).toBe(1);
      }
      expect(
        await options.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
    },
  );
});
