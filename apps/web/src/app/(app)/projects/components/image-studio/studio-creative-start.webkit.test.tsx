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
import { StudioProjectScopePrompt } from "@/app/studio/components/studio-project-scope-prompt";
import english from "../../../../../../messages/en.json";
import { StudioCreativeStart } from "./studio-creative-start";

vi.mock("@/lib/auth/auth.client", () => ({ authClient: {} }));
// A workspace with projects: the empty state offers Select project and Start
// from a website beside Choose what to make, the row production showed uneven.
vi.mock("@/app/components/project-scope/use-scope-projects", () => ({
  useHasAnyScopeProject: () => ({ isPending: false, hasProjects: true }),
}));

const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../../..");
const studio = english.App.Studio;

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
  profile = await mkdtemp(path.join(WEB_ROOT, "node_modules/.studio-start-"));
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

/** The empty state's action row as `image-studio.tsx` lays it out. */
async function showEmptyState(width: number) {
  await page.setViewportSize({ width, height: 600 });
  const markup = renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={english} timeZone="UTC">
      <div className="space-y-2 px-4 pt-8 text-center">
        <h2 className="text-foreground text-3xl font-semibold text-balance">
          {studio.emptyTitle}
        </h2>
        <p className="text-muted-foreground text-sm text-pretty">
          {studio.emptyBody}
        </p>
        <div
          className="pointer-events-auto inline-flex flex-wrap items-center justify-center gap-2"
          data-testid="studio-empty-actions"
        >
          <StudioProjectScopePrompt
            body={studio.pickBody}
            createActionLabel={studio.startFromWebsite}
          />
          <StudioCreativeStart
            onApplyBrief={() => {}}
            onFocusPrompt={() => {}}
          />
        </div>
      </div>
    </NextIntlClientProvider>,
  );
  await page.setContent(
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`,
  );
}

describe("Content Studio empty state actions", () => {
  it.each([390, 1024, 1440])(
    "gives all three buttons one height at %ipx",
    async (width) => {
      await showEmptyState(width);
      const names = [
        english.App.ProjectScope.selectProject,
        studio.startFromWebsite,
        studio.CreativeStart.open,
      ];
      const heights = [];
      for (const name of names) {
        const box = await page
          .getByRole("button", { name, exact: true })
          .boundingBox();
        if (!box) throw new Error(`${name} is hidden`);
        heights.push(box.height);
      }
      expect(new Set(heights).size, `heights ${heights.join(", ")}`).toBe(1);
    },
  );
});
