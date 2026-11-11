import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { StudioProductPhoto } from "@sokosumi/core-client";
import tailwindcss from "@tailwindcss/postcss";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { type BrowserContext, chromium, type Page } from "playwright";
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
  vi,
} from "vitest";
import german from "../../../../../../messages/de.json";
import english from "../../../../../../messages/en.json";
import { StudioComposer } from "./studio-composer";
import { TEST_CATALOG } from "./studio-fixtures";
import { buildStudioLabels } from "./studio-labels";
import { StudioModeSwitch } from "./studio-video-composer";

vi.mock("@/lib/auth/auth.client", () => ({ authClient: {} }));
vi.mock("./studio-approved-headlines", () => ({
  readApprovedStudioHeadlines: vi.fn(),
}));

const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../../..");
const catalog = {
  ...TEST_CATALOG,
  models: Array.from({ length: 6 }, (_unused, index) => ({
    ...TEST_CATALOG.models[index % TEST_CATALOG.models.length],
    id: `toolbar-model-${index}`,
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
  profile = await mkdtemp(path.join(WEB_ROOT, "node_modules/.studio-toolbar-"));
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

interface ComposerScenario {
  photo?: StudioProductPhoto | null;
  prompt?: string;
  undo?: boolean;
  locale?: "en" | "de";
}

async function showComposer(
  width: number,
  {
    photo = null,
    prompt = "",
    undo = false,
    locale = "en",
  }: ComposerScenario = {},
) {
  const messages = locale === "de" ? german : english;
  const translate = createTranslator({ locale, messages: messages.App.Studio });
  const labels = buildStudioLabels((key) =>
    translate(key as Parameters<typeof translate>[0]),
  );
  await page.setViewportSize({ width, height: 800 });
  const markup = renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <div className="flex">
        <aside className="hidden w-64 shrink-0 md:block" />
        <main className="min-w-0 flex-1 p-4">
          <div className="mx-auto w-full max-w-3xl">
            <StudioComposer
              busy={false}
              catalog={catalog}
              labels={labels}
              modeSwitch={
                <StudioModeSwitch
                  labels={labels}
                  mode="image"
                  onModeChange={() => {}}
                />
              }
              onApplyTemplate={() => {}}
              onClearReferences={() => {}}
              onGenerate={() => {}}
              onPhotoUploadChange={() => {}}
              onProductPhotoChange={() => {}}
              onPromptChange={() => {}}
              onTargetChange={() => {}}
              onUndoTemplate={undo ? () => {} : undefined}
              productPhoto={photo}
              prompt={prompt}
              referenceAssets={[]}
              target={{
                modelIds: catalog.models.map(({ id }) => id),
                settings: {
                  aspectRatio: "1:1",
                  resolution: "0.5K",
                  outputFormat: "png",
                  seed: null,
                },
              }}
            />
          </div>
        </main>
      </div>
    </NextIntlClientProvider>,
  );
  await page.setContent(
    `<!doctype html><html lang="${locale}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`,
  );
}

async function expectToolbarFits(summaryName = /^Will run/) {
  const form = page.locator("form");
  const overflowing = await form.evaluate((element) =>
    [element, ...element.querySelectorAll("*")]
      .filter((child) => {
        const { overflowX } = getComputedStyle(child);
        return (
          ["auto", "scroll"].includes(overflowX) &&
          child.scrollWidth > child.clientWidth
        );
      })
      .map((child) => ({
        text: child.textContent,
        width: child.clientWidth,
        scrollWidth: child.scrollWidth,
      })),
  );
  expect.soft(overflowing).toEqual([]);

  const controls = await form.locator('button, [role="radio"]').all();
  const boxes = [];
  for (const control of controls) {
    const box = await control.boundingBox();
    if (!box) throw new Error("Toolbar control is hidden");
    boxes.push(box);
    if (!(await control.isDisabled())) {
      expect(
        await control.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return (
            document
              .elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2,
              )
              ?.closest("button") === element
          );
        }),
      ).toBe(true);
    }
  }
  for (const [index, box] of boxes.entries()) {
    for (const other of boxes.slice(index + 1)) {
      const overlapWidth =
        Math.min(box.x + box.width, other.x + other.width) -
        Math.max(box.x, other.x);
      const overlapHeight =
        Math.min(box.y + box.height, other.y + other.height) -
        Math.max(box.y, other.y);
      expect(overlapWidth > 0.5 && overlapHeight > 0.5).toBe(false);
    }
  }

  const summary = page.getByRole("button", { name: summaryName });
  expect(await summary.count()).toBe(1);
  expect(
    await summary.evaluate((element) =>
      [...element.querySelectorAll("span")].every(
        (span) => span.scrollWidth <= span.clientWidth,
      ),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()?.width,
  );
}

describe("Content Studio composer toolbar", () => {
  it.each([320, 390, 1024, 1280, 1440])(
    "keeps both add actions and every summary clear of overlap and horizontal scroll at %ipx",
    async (width) => {
      await showComposer(width);
      expect(
        await page
          .getByRole("button", { name: "Add product photo", exact: true })
          .count(),
      ).toBe(1);
      expect(
        await page
          .getByRole("button", {
            name: english.App.Studio.templates,
            exact: true,
          })
          .count(),
      ).toBe(1);
      expect(
        await page.getByRole("radio", { name: "Image", exact: true }).count(),
      ).toBe(1);
      expect(
        await page.getByRole("radio", { name: "Video", exact: true }).count(),
      ).toBe(1);
      expect(await page.getByRole("button", { name: /^Model/ }).count()).toBe(
        1,
      );
      expect(await page.getByRole("button", { name: /^Options/ }).count()).toBe(
        1,
      );
      await expectToolbarFits();
    },
  );

  it("keeps a selected product photo and its removal control inside the narrow composer", async () => {
    await showComposer(390, {
      photo: {
        id: "photo-1",
        name: "a-very-long-product-photo-filename-for-the-ad-composer.png",
      },
    });
    expect(
      await page
        .getByRole("button", { name: "Remove product photo", exact: true })
        .count(),
    ).toBe(1);
    await expectToolbarFits();
  });

  it("keeps undo, character count and the plan visible beside a nearly full narrow prompt", async () => {
    await showComposer(390, { prompt: "x".repeat(3600), undo: true });
    expect(
      await page
        .getByRole("button", {
          name: english.App.Studio.undoTemplate,
          exact: true,
        })
        .count(),
    ).toBe(1);
    expect(await page.getByText("3,600 / 4,000").count()).toBe(1);
    await expectToolbarFits();
  });

  it("fits longer German labels on the narrow composer", async () => {
    await showComposer(390, { locale: "de" });
    expect(
      await page
        .getByRole("button", {
          name: german.App.Studio.addProductPhoto,
          exact: true,
        })
        .count(),
    ).toBe(1);
    expect(
      await page
        .getByRole("button", { name: german.App.Studio.templates, exact: true })
        .count(),
    ).toBe(1);
    await expectToolbarFits(/^Läuft/);
  });
});
