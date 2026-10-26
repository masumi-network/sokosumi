import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";

import tailwindcss from "@tailwindcss/postcss";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
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
import { SocialAllProjectsTabs } from "@/app/social/components/social-all-projects-tabs";
import { Button } from "@/components/ui/button";

import german from "../../../../../../messages/de.json";
import english from "../../../../../../messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {} }),
}));
vi.mock("@/app/social/components/social-accounts-project-prompt", () => ({
  SocialAccountsProjectPrompt: () => <p>Accounts panel</p>,
}));
vi.mock(
  "@/app/projects/components/social-posts/social-post-statistics",
  () => ({
    SocialPostStatistics: () => null,
  }),
);

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
  profile = await mkdtemp(path.join(WEB_ROOT, "node_modules/.social-layout-"));
  context = await chromium.launchPersistentContext(profile, {
    // Use installed Chrome when the optional Playwright download is absent.
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

async function show(markup: string) {
  await page.setContent(
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`,
  );
}

describe("Social tabs layout", () => {
  it.each([
    { width: 320, locale: "en", messages: english },
    { width: 390, locale: "en", messages: english },
    { width: 390, locale: "de", messages: german },
    { width: 1280, locale: "en", messages: english },
  ])(
    "shows every tab and the new-post action at $width px ($locale)",
    async ({ width, locale, messages }) => {
      await page.setViewportSize({ width, height: 800 });
      await show(
        renderToStaticMarkup(
          <NextIntlClientProvider locale={locale} messages={messages}>
            <NuqsTestingAdapter searchParams="?tab=accounts">
              <div className="p-4">
                <SocialAllProjectsTabs
                  actions={
                    <Button className="h-11 shrink-0 md:h-10" size="sm">
                      +<span className="sr-only md:not-sr-only">New post</span>
                    </Button>
                  }
                  calendar={<p>Calendar</p>}
                  workspaceId="workspace-1"
                />
              </div>
            </NuqsTestingAdapter>
          </NextIntlClientProvider>,
        ),
      );
      const tabs = page.getByRole("tab");
      expect(await tabs.count()).toBe(5);
      const firstTab = await tabs.first().boundingBox();
      if (!firstTab) throw new Error("First tab is hidden");
      const action = await page
        .getByRole("button", { name: "New post" })
        .boundingBox();
      if (!action) throw new Error("New post is hidden");
      for (const tab of await tabs.all()) {
        const box = await tab.boundingBox();
        if (!box) throw new Error("Tab is hidden");
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(action.x);
        expect(
          await tab.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return (
              document
                .elementFromPoint(
                  rect.x + rect.width / 2,
                  rect.y + rect.height / 2,
                )
                ?.closest('[role="tab"]') === element
            );
          }),
        ).toBe(true);
        if (width >= 768) expect(box.y).toBeCloseTo(firstTab.y);
      }
      expect(
        await page.getByRole("tab", { selected: true }).textContent(),
      ).toContain(messages.App.Projects.SocialPosts.sections.accounts);
      expect(
        await page
          .getByRole("tablist")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      expect(action.x + action.width).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
    },
  );
});

describe("App-wide preview overlay clearance", () => {
  it.each([390, 1280])(
    "scrolls and focuses the last control clear of the toolbar at %ipx",
    async (width) => {
      await page.setViewportSize({ width, height: 800 });
      await show(`<main data-app-main class="flex h-dvh flex-col overflow-y-auto p-4">
      <div data-app-main-inner class="flex min-h-full flex-1 flex-col">
        <button type="button" class="mt-auto h-11 self-end" id="last">Last control</button>
      </div>
      </main>`);
      const main = page.locator("main");
      expect(
        await main.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        ),
      ).toBe(0);
      await page.evaluate(() => {
        document.body.insertAdjacentHTML(
          "beforeend",
          `<vercel-live-feedback><button type="button" style="position:fixed;right:16px;bottom:16px;width:44px;height:44px" onclick="this.dataset.activated='true'">Preview tools</button></vercel-live-feedback>`,
        );
      });
      const last = page.getByRole("button", { name: "Last control" });
      await last.focus();
      await main.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const control = await last.boundingBox();
      const launcher = await page
        .getByRole("button", { name: "Preview tools" })
        .boundingBox();
      if (!control || !launcher) throw new Error("Control is hidden");
      expect(control.y + control.height).toBeLessThanOrEqual(launcher.y - 8);
      expect(
        await last.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return (
            document.elementFromPoint(
              rect.right - 4,
              rect.y + rect.height / 2,
            ) === element
          );
        }),
      ).toBe(true);
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      expect(
        await page
          .getByRole("button", { name: "Preview tools" })
          .getAttribute("data-activated"),
      ).toBe("true");
    },
  );
});
