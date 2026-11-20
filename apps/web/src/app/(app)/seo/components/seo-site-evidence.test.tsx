import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { expect, it } from "vitest";
import { SeoResultMessagesProvider } from "@/i18n/use-seo-result-translations";
import de from "../../../../../messages/de.json";
import en from "../../../../../messages/en.json";
import { SeoSiteEvidence } from "./seo-site-evidence";

it("shows dated public link evidence in English without a Google result", () => {
  const page = "https://example.com/guide";
  const target = "https://example.com/removed";
  render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="UTC">
      <SeoResultMessagesProvider messages={en.App.Seo}>
        <SeoSiteEvidence
          evidence={{
            taskId: "task",
            auditPageUrl: page,
            observedAt: new Date("2026-11-20T12:00:00Z"),
            complete: false,
            coverage: {
              discovered: 25,
              deferredCount: 24,
              deferred: [{ url: page + "/next", reason: "read_limit" }],
            },
            sampledPages: [page],
            targets: [
              {
                targetUrl: target,
                donorUrls: [page],
                contentDonorUrls: [page],
                sitemapUrls: [],
                action: "Replace the broken link on the guide page.",
                status: "fix_link",
                httpStatus: 404,
                trend: {
                  previousAt: new Date("2026-11-01T12:00:00Z"),
                  previousCount: 2,
                  currentCount: 1,
                },
              },
            ],
          }}
        />
      </SeoResultMessagesProvider>
    </NextIntlClientProvider>,
  );
  expect(screen.getByRole("link", { name: target })).toHaveAttribute(
    "href",
    target,
  );
  expect(
    screen.getByText("The audit collected only part of the sample."),
  ).toBeVisible();
  expect(
    screen.getByText(
      "Eligible URLs: 25. Public responses verified: 1. Deferred: 24.",
    ),
  ).toBeVisible();
  expect(screen.getByText("Deferred URLs (1 shown)")).toBeVisible();
  expect(
    screen.getByText("The audit reached its public request limit."),
  ).toBeInTheDocument();
  expect(screen.getByText("Target returned HTTP 404.")).toBeVisible();
  expect(
    screen.getByText("Replace the broken link on the guide page."),
  ).toBeVisible();
  expect(
    screen.getByText("Sampled pages linking here: 2 on 2026-11-01, now 1."),
  ).toBeVisible();
  expect(screen.queryByText(/Google’s recorded index status/)).toBeNull();
});

it("labels Google referring URLs and sitemaps separately from sampled internal links", async () => {
  const url = "https://example.com/page";
  const referrer = "https://example.com/referrer";
  const sitemap = "https://example.com/sitemap.xml";
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <SeoSiteEvidence
        evidence={{
          taskId: "task",
          auditPageUrl: url,
          observedAt: new Date("2026-11-20"),
          sampledPages: [url],
          complete: true,
          targets: [
            {
              targetUrl: url,
              status: "observed",
              action: "Keep monitoring this page.",
              donorUrls: [],
              contentDonorUrls: [],
              sitemapUrls: [],
              googleReferringPages: [referrer],
              googleSitemapUrls: [sitemap],
            },
          ],
        }}
      />
    </NextIntlClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByText(en.App.Seo.discovery.referringPages));
  await user.click(screen.getByText(en.App.Seo.discovery.reportedSitemaps));
  expect(screen.getByRole("link", { name: referrer })).toHaveAttribute(
    "href",
    referrer,
  );
  expect(screen.getByRole("link", { name: sitemap })).toHaveAttribute(
    "href",
    sitemap,
  );
  expect(
    screen.getByText(
      "Sampled pages linking here: 0. No comparable earlier sample.",
    ),
  ).toBeVisible();
  expect(screen.queryByText(en.App.Seo.siteEvidence.donors)).toBeNull();
});

it("shows three dated counts and the missing source for a repeated decline", () => {
  const page = "https://example.com/recent";
  const lost = "https://example.com/guide";
  const points = ["2026-11-01", "2026-11-10", "2026-11-20"].map((date, i) => ({
    at: new Date(date),
    count: 3 - i,
  }));
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <SeoSiteEvidence
        evidence={{
          taskId: "task",
          auditPageUrl: page,
          observedAt: new Date("2026-11-20"),
          sampledPages: [page, lost],
          complete: true,
          targets: [
            {
              targetUrl: "https://example.com/service",
              status: "review",
              action: "Review the guide link.",
              donorUrls: [page],
              contentDonorUrls: [],
              sitemapUrls: [],
              trend: {
                previousAt: new Date("2026-11-10"),
                previousCount: 2,
                currentCount: 1,
                decline: { points, missingDonorUrls: [lost] },
              },
            },
          ],
        }}
      />
    </NextIntlClientProvider>,
  );
  expect(
    screen.getByRole("heading", { name: en.App.Seo.siteEvidence.decline }),
  ).toBeVisible();
  expect(screen.getByText("2026-11-01: 3 linking pages")).toBeVisible();
  expect(screen.getByText("2026-11-10: 2 linking pages")).toBeVisible();
  expect(screen.getByText("2026-11-20: 1 linking page")).toBeVisible();
  expect(screen.getByText(en.App.Seo.siteEvidence.lostDonors)).toBeVisible();
  expect(
    within(
      screen.getByRole("list", { name: en.App.Seo.siteEvidence.lostDonors }),
    ).getByRole("link", { name: lost }),
  ).toHaveAttribute("href", lost);
});

it.each([
  [[], "Link coverage is unknown because no source pages were sampled."],
  [
    ["https://example.com/source"],
    "Linking pages observed in this partial sample: 0.",
  ],
] as const)(
  "avoids claiming a baseline for an incomplete sample %j",
  (pages, label) => {
    const url = "https://example.com/target";
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <SeoSiteEvidence
          evidence={{
            taskId: "task",
            auditPageUrl: url,
            observedAt: new Date("2026-11-20"),
            sampledPages: [...pages],
            complete: false,
            targets: [
              {
                targetUrl: url,
                status: "review",
                action: "Review this target.",
                donorUrls: [],
                contentDonorUrls: [],
                sitemapUrls: [],
              },
            ],
          }}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(label)).toBeVisible();
    expect(screen.queryByText(/No comparable earlier sample/)).toBeNull();
  },
);
