import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import { NextIntlClientProvider } from "next-intl";
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
import { StudioProjectToolbar } from "./studio-project-toolbar";
import { StudioWebsiteTools } from "./studio-website-tools";

vi.mock("@/lib/auth/auth.client", () => ({ authClient: {} }));
vi.mock("@/lib/actions/image-studio/brand-kit", () => ({}));
vi.mock("@/lib/actions/image-studio/product-catalog", () => ({}));

const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../../..");

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
  profile = await mkdtemp(
    path.join(WEB_ROOT, "node_modules/.studio-project-toolbar-"),
  );
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

async function showToolbar(width: number, locale: "en" | "de" = "en") {
  const messages = locale === "de" ? german : english;
  await page.setViewportSize({ width, height: 600 });
  const markup = renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <StudioProjectToolbar assistantOpen={false} onAssistantToggle={() => {}}>
        <StudioWebsiteTools
          canUseProduct
          onLogoChange={() => {}}
          onUseBatch={() => {}}
          onUseProduct={() => {}}
          projectId="project-1"
          websiteUrl="https://example.com"
        />
      </StudioProjectToolbar>
    </NextIntlClientProvider>,
  );
  await page.setContent(
    `<!doctype html><html lang="${locale}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`,
  );
  const studio = messages.App.Studio;
  return [
    studio.WebsiteDraft.prepare,
    studio.brandKit,
    studio.ProductCatalog.title,
    studio.Assistant.title,
  ];
}

async function toolbarBoxes(names: string[]) {
  const boxes = [];
  for (const name of names) {
    const button = page.getByRole("button", { name, exact: true });
    expect(await button.count()).toBe(1);
    const box = await button.boundingBox();
    if (!box) throw new Error(`${name} is hidden`);
    boxes.push(box);
  }
  return boxes;
}

describe("Content Studio project toolbar", () => {
  it.each([
    [320, "en"],
    [390, "en"],
    [390, "de"],
    [767, "de"],
  ] as const)(
    "keeps every action named and on one row at %ipx (%s)",
    async (width, locale) => {
      const boxes = await toolbarBoxes(await showToolbar(width, locale));
      for (const box of boxes) {
        expect(box.y).toBe(boxes[0].y);
        // Icon only: the label is hidden, so the button is about square.
        expect(box.width).toBeLessThanOrEqual(box.height + 8);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
    },
  );

  it.each([768, 1024, 1440])(
    "shows every label on one row at %ipx",
    async (width) => {
      const names = await showToolbar(width);
      const boxes = await toolbarBoxes(names);
      for (const [index, box] of boxes.entries()) {
        expect(box.y).toBe(boxes[0].y);
        expect(box.width).toBeGreaterThan(box.height * 2);
        expect(
          await page
            .getByRole("button", { name: names[index], exact: true })
            .innerText(),
        ).toBe(names[index]);
      }
    },
  );
});
