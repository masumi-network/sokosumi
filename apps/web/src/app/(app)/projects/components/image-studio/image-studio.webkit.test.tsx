import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import { createTranslator } from "next-intl";
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
import spanish from "../../../../../../messages/es.json";
import { FailedJob } from "./image-studio";
import { STUDIO_COMPOSER_GUTTER_CLASS } from "./studio-classes";
import { TEST_CATALOG } from "./studio-fixtures";
import { buildStudioLabels } from "./studio-labels";
import type { StudioJob } from "./types";

vi.mock("@/lib/auth/auth.client", () => ({ authClient: {} }));
vi.mock("./studio-approved-headlines", () => ({
  readApprovedStudioHeadlines: vi.fn(),
}));

const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../../..");
const MESSAGES = { en: english, de: german, es: spanish } as const;
/** As long a name as the catalog carries, so the line wraps where it will. */
const catalog = {
  ...TEST_CATALOG,
  models: [
    { ...TEST_CATALOG.models[0], label: "Gemini 3.1 Flash Image" },
    ...TEST_CATALOG.models.slice(1),
  ],
};
const job = {
  id: "failed",
  status: "FAILED",
  kind: "GENERATE",
  model: catalog.models[0].generateEndpoint,
  error: "Unexpected status code: 422",
  failureReason: "provider_error",
  retryMayDuplicateCharge: false,
} as unknown as StudioJob;

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
  profile = await mkdtemp(path.join(WEB_ROOT, "node_modules/.studio-failure-"));
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

async function showFailure(width: number, locale: keyof typeof MESSAGES) {
  const translate = createTranslator({
    locale,
    messages: MESSAGES[locale].App.Studio,
  });
  const labels = buildStudioLabels((key) =>
    translate(key as Parameters<typeof translate>[0]),
  );
  await page.setViewportSize({ width, height: 400 });
  const markup = renderToStaticMarkup(
    <div className="flex">
      <aside className="hidden w-56 shrink-0 md:block" />
      <main className={`min-w-0 flex-1 py-4 ${STUDIO_COMPOSER_GUTTER_CLASS}`}>
        <FailedJob
          catalog={catalog}
          job={job}
          labels={labels}
          onDismiss={() => {}}
          onRefresh={() => {}}
          onRetry={() => {}}
        />
      </main>
    </div>,
  );
  await page.setContent(
    `<!doctype html><html lang="${locale}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`,
  );
  return labels;
}

async function box(selector: string) {
  const found = await page.locator(selector).first().boundingBox();
  if (!found) throw new Error(`${selector} is not laid out`);
  return found;
}

describe("Content Studio failure notice", () => {
  it.each([
    [390, "en"],
    [390, "de"],
    [390, "es"],
    [1024, "en"],
    [1440, "en"],
    [1440, "de"],
  ] as const)(
    "keeps the failure to one line beside Try again and dismiss at %ipx (%s)",
    async (width, locale) => {
      const labels = await showFailure(width, locale);
      const notice = await box('[role="status"]');
      const summary = await box("summary");
      const retry = await box(`button:has-text("${labels.tryAgain}")`);
      const dismiss = await box(`button[aria-label="${labels.close}"]`);

      // The line is never covered by either button, and dismiss stays on the
      // line's row at the far edge.
      const overlaps = (a: typeof notice, b: typeof notice) =>
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height;
      expect(overlaps(summary, retry)).toBe(false);
      expect(overlaps(summary, dismiss)).toBe(false);
      expect(dismiss.y).toBeLessThan(summary.y + 20);

      const sameRow = Math.abs(retry.y - summary.y) <= 1;
      const lines = Math.round((summary.height - 12) / 20);
      if (width >= 1024 || locale === "en") {
        // Try again beside the line: one row, no button row underneath.
        expect(sameRow).toBe(true);
      } else {
        // A longer translation drops Try again directly under the line
        // rather than squeezing the line into a narrow column.
        expect(sameRow || retry.y >= summary.y + summary.height).toBe(true);
      }
      // Wide, a single line of text; narrow, at most two.
      expect(lines).toBeLessThanOrEqual(width >= 1024 ? 1 : 2);
      // Production showed ~165px at 390 for title, sentence, toggle, button.
      expect(notice.height).toBeLessThanOrEqual(width >= 1024 ? 56 : 112);

      // The reason and the provider's words wait behind the line.
      expect(
        await page.getByText(labels.failedBody.provider_error).isVisible(),
      ).toBe(false);
      expect(await page.getByText(job.error ?? "").isVisible()).toBe(false);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
    },
  );

  it("opens to the reason and the provider's words without moving Try again", async () => {
    const labels = await showFailure(390, "en");
    const before = await box(`button:has-text("${labels.tryAgain}")`);
    await page.locator("summary").click();

    expect(
      await page.getByText(labels.failedBody.provider_error).isVisible(),
    ).toBe(true);
    expect(await page.getByText(job.error ?? "").isVisible()).toBe(true);
    expect(await box(`button:has-text("${labels.tryAgain}")`)).toEqual(before);
  });
});
