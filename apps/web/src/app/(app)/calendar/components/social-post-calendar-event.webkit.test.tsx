import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type SocialPostCalendarItem,
  SocialPostStatus,
} from "@sokosumi/core-client";
import tailwindcss from "@tailwindcss/postcss";
import { NextIntlClientProvider } from "next-intl";
import { type Browser, type Page, webkit } from "playwright";
import postcss from "postcss";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { SocialPostCalendarEvent } from "./social-post-calendar-event";

vi.mock("@/app/social/components/social-calendar-preview", () => ({
  useSocialCalendarPreview: () => null,
}));
vi.mock("@/lib/actions/project/action", () => ({
  scheduleProjectSocialPost: vi.fn(),
}));

const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const POST: SocialPostCalendarItem = {
  kind: "socialPost",
  id: "social:launch",
  postId: "launch",
  sourceProjectId: "masumi",
  sourceWorkspaceId: "workspace",
  sourceId: "project:masumi",
  sourceType: "PROJECT",
  provider: "x",
  status: "SCHEDULED",
  revision: 1,
  scheduledAt: new Date("2030-01-02T09:00:00Z"),
  text: "Launch post",
  projectName: "Masumi",
  externalHandle: "masumi",
  avatarUrl: null,
  scheduledByName: "Masumi",
  scheduledByImage: null,
  attachmentCount: 0,
  previewMedia: null,
  quotedPostId: null,
  needsAttentionReason: null,
  threadPartCount: 1,
  publishedThreadPartCount: 0,
  failedThreadPartPosition: null,
  partiallyPublished: false,
  lastAttempt: null,
};
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
  await page.route("**/*", (route) => route.abort());
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

it.each([
  { width: 1440, theme: "light" },
  { width: 1440, theme: "dark" },
  { width: 390, theme: "light" },
  { width: 390, theme: "dark" },
])(
  "keeps every calendar status visible and AA in $theme at $width px",
  async ({ width, theme }) => {
    await page.setViewportSize({ width, height: 900 });
    const markup = renderToStaticMarkup(
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        messages={messages}
        formats={createFormats("h23")}
      >
        <main className="bg-background text-foreground p-4">
          {(["month", "week"] as const).map((variant) => (
            <section className="grid gap-2 md:grid-cols-7" key={variant}>
              {Object.values(SocialPostStatus).map((status) => (
                <SocialPostCalendarEvent
                  key={status}
                  item={{ ...POST, status }}
                  timeZone="UTC"
                  variant={variant}
                  showProject={false}
                />
              ))}
            </section>
          ))}
          <section className="mt-4 flex flex-wrap gap-2" data-badges>
            {Object.values(SocialPostStatus).map((status) => (
              <SocialPostStatusBadge
                key={status}
                status={status}
                label={messages.App.Projects.SocialPosts.status[status]}
              />
            ))}
          </section>
        </main>
      </NextIntlClientProvider>,
    );
    await page.setContent(
      `<!doctype html><html lang="en" class="${theme === "dark" ? "dark" : ""}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`,
    );
    const results = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing color canvas");
      function luminance(color: string) {
        if (!context) throw new Error("Missing color canvas");
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [red, green, blue] = [...context.getImageData(0, 0, 1, 1).data]
          .slice(0, 3)
          .map((byte) => {
            const value = byte / 255;
            return value <= 0.04045
              ? value / 12.92
              : ((value + 0.055) / 1.055) ** 2.4;
          });
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      }
      function background(element: Element): string {
        const color = getComputedStyle(element).backgroundColor;
        return color === "rgba(0, 0, 0, 0)" && element.parentElement
          ? background(element.parentElement)
          : color;
      }
      function contrast(
        element: Element,
        color = getComputedStyle(element).color,
      ) {
        const foreground = luminance(color);
        const surface = luminance(background(element));
        return (
          (Math.max(foreground, surface) + 0.05) /
          (Math.min(foreground, surface) + 0.05)
        );
      }
      return [
        ...document.querySelectorAll('[data-testid="calendar-social-post"]'),
      ].map((card) => {
        const status = card.getAttribute("data-status");
        const badge = card.querySelector(
          `[data-testid="social-post-status-${status}"]`,
        );
        const icon = badge?.querySelector("svg");
        const rail = card.querySelector(
          '[data-testid="calendar-social-post-rail"]',
        );
        const labeled = document.querySelector(
          `[data-badges] [data-testid="social-post-status-${status}"]`,
        );
        const labeledIcon = labeled?.querySelector("svg");
        if (!badge || !icon || !rail || !labeled || !labeledIcon)
          throw new Error(`Missing status ${status}`);
        const rect = badge.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        return {
          status,
          label: card.getAttribute("aria-label"),
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left >= cardRect.left &&
            rect.right <= cardRect.right,
          iconColor: getComputedStyle(icon).color,
          badgeColor: getComputedStyle(labeledIcon).color,
          railColor: getComputedStyle(rail).backgroundColor,
          iconContrast: contrast(icon),
          railContrast: contrast(card, getComputedStyle(rail).backgroundColor),
          labelContrast: contrast(labeled),
          textContrast: contrast(card),
        };
      });
    });
    expect(results).toHaveLength(16);
    for (const result of results) {
      expect(result.visible, result.status ?? "status").toBe(true);
      expect(result.label).toContain(
        messages.App.Projects.SocialPosts.status[
          result.status as SocialPostStatus
        ],
      );
      expect(result.railColor).not.toBe("rgba(0, 0, 0, 0)");
      expect(result.railColor).toBe(result.iconColor);
      expect(result.badgeColor).toBe(result.iconColor);
      expect(result.iconContrast).toBeGreaterThanOrEqual(3);
      expect(result.railContrast).toBeGreaterThanOrEqual(3);
      expect(result.labelContrast).toBeGreaterThanOrEqual(4.5);
      expect(result.textContrast).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  },
);
