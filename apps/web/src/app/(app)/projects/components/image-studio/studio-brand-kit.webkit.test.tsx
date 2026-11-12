// @vitest-environment happy-dom
/**
 * Brand kit dialog layout in a real browser: Close and Save stay on screen
 * while the kit scrolls. The real dialog opens and loads in happy-dom; its
 * markup is then laid out by Chromium with the app's compiled CSS.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { type BrowserContext, chromium, type Page } from "playwright";
import postcss from "postcss";
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
import english from "../../../../../../messages/en.json";
import { StudioBrandKitDialog } from "./studio-brand-kit";

vi.mock("@/lib/actions/image-studio/brand-kit", () => ({
  findStudioWebsiteLogo: vi.fn(),
  getStudioBrandKit: vi.fn().mockResolvedValue({
    logo: null,
    colors: ["#a33421", "#23453c", "#f4efe6"],
    fonts: ["Inter", "Fraunces"],
    summary: "A ceramics studio making tableware from reclaimed clay.",
    tone: "Direct, warm and plain-spoken.",
    audience: ["Home cooks", "Restaurants"],
    approvedLines: ["Made from reclaimed clay.", "Fired in Prague."],
    version: new Date("2026-11-09T12:00:00.000Z"),
  }),
  getStudioWebsiteCopy: vi.fn(),
  saveStudioBrandCopy: vi.fn(),
  saveStudioBrandLook: vi.fn(),
  saveStudioLogoPosition: vi.fn(),
  saveStudioWebsiteLogo: vi.fn(),
  uploadStudioProjectLogo: vi.fn(),
}));
vi.mock("@/lib/actions/design-md/action", () => ({
  startDesignMdGeneration: vi.fn(),
  pollDesignMdGeneration: vi.fn(),
  finalizeDesignMdGeneration: vi.fn(),
}));

const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../../..");
const LABELS = english.App.Studio.BrandKit;

let context: BrowserContext;
let page: Page;
let profile: string;
let css: string;
let markup: string;

beforeAll(async () => {
  const source = path.join(WEB_ROOT, "src/app/globals.css");
  css = (
    await postcss([tailwindcss()]).process(await readFile(source, "utf8"), {
      from: source,
    })
  ).css;

  render(
    <NextIntlClientProvider locale="en" messages={english} timeZone="UTC">
      <StudioBrandKitDialog
        onLogoChange={() => {}}
        projectId="p"
        websiteUrl="https://example.com"
      />
    </NextIntlClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: english.App.Studio.brandKit }),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLTextAreaElement>(LABELS.approvedLines).disabled,
    ).toBe(false),
  );
  markup = document.body.innerHTML;
  cleanup();

  profile = await mkdtemp(path.join(WEB_ROOT, "node_modules/.studio-kit-"));
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

async function showDialog(width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`,
  );
  // Settle the open animation so the dialog is measured as it rests.
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });
}

async function expectOnScreen(name: string) {
  const button = page.getByRole("button", { name, exact: true });
  const box = await button.boundingBox();
  if (!box) throw new Error(`${name} is hidden`);
  const viewport = page.viewportSize();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport?.height ?? 0);
  // Save stays disabled, so it takes no pointer, until the kit is edited.
  if (await button.isDisabled()) return;
  expect(
    await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        document
          .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          ?.closest("button") === element
      );
    }),
  ).toBe(true);
}

describe("Content Studio brand kit dialog", () => {
  it.each([
    [390, 844],
    [1440, 900],
  ])(
    "keeps Close and Save on screen while the kit scrolls at %ipx",
    async (width, height) => {
      await showDialog(width, height);
      const dialog = page.getByRole("dialog");
      // The dialog itself never scrolls its footer away.
      expect(
        await dialog.evaluate(
          (element) => element.scrollHeight <= element.clientHeight,
        ),
      ).toBe(true);
      if (width < 640) {
        // On a phone the kit is taller than the screen, so its body scrolls.
        expect(
          await page.locator("fieldset").evaluate((element) => {
            let scroller = element.parentElement;
            while (
              scroller &&
              !["auto", "scroll"].includes(getComputedStyle(scroller).overflowY)
            )
              scroller = scroller.parentElement;
            return Boolean(
              scroller && scroller.scrollHeight > scroller.clientHeight,
            );
          }),
        ).toBe(true);
      }

      await expectOnScreen(LABELS.close);
      await expectOnScreen(LABELS.save);
    },
  );
});
