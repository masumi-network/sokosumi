/**
 * Vite page for `scripts/capture-performance-screenshots.mjs`.
 * Mounts the real Performance header and Settings Sync now control.
 */
import type { ProjectSocialConnection } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { createRoot } from "react-dom/client";
import { ProjectSocialAccounts } from "@/app/projects/components/project-social-accounts";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createFormats } from "@/i18n/time-format";
import messages from "@/messages/en.json";
import { SocialPostStatistics } from "../social-post-statistics";

type Shot = "updated" | "syncing" | "reconnect" | "settings";

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

function snapshot(fetchedMinutes: number, attemptedMinutes: number) {
  return {
    metrics: [
      { key: "followers", value: 12500, period: "lifetime", unit: null },
      { key: "impressions", value: 334000, period: "days_28", unit: null },
    ],
    fetchedAt: minutesAgo(fetchedMinutes),
    refreshAttemptedAt: minutesAgo(attemptedMinutes),
    error: null,
    historyNextCursor: null,
    historyComplete: true,
    historyFetchedAt: minutesAgo(fetchedMinutes),
    historyError: null,
    metricWarning: null,
  };
}

function account(
  id: string,
  name: string,
  handle: string,
  stats: ReturnType<typeof snapshot>,
  status: "active" | "reauthorization_required" = "active",
) {
  return {
    id,
    provider: "x" as const,
    displayName: name,
    externalHandle: handle,
    status,
    statistics: stats,
    postCount: 14,
  };
}

function page(accounts: ReturnType<typeof account>[]) {
  const metric = (total: number | null) => ({
    total,
    mean: total,
    median: total,
    measuredPostCount: total == null ? 0 : 14,
  });
  const summary = {
    postCount: 14,
    measuredPostCount: 14,
    metrics: {
      views: metric(1373),
      impressions: metric(334000),
      likes: metric(612),
      comments: metric(188),
      shares: metric(118),
      saves: metric(null),
    },
    interactions: metric(918),
    engagementRates: [],
    additionalMetrics: [],
  };
  return {
    accounts,
    posts: [
      {
        id: "post-1",
        connectionId: accounts[0]?.id ?? ACCOUNT_ID,
        provider: "x",
        externalId: "123",
        publishedAt: "2026-10-01T00:15:00Z",
        text: "Published outside Sokosumi",
        url: "https://x.com/masumi/status/123",
        metrics: {
          views: 1373,
          impressions: 334000,
          likes: 612,
          comments: 188,
          shares: 118,
          saves: null,
        },
        contentType: "text",
        postKind: "post",
        media: [],
        interactions: 918,
        engagementRate: 0.27,
        engagementDenominator: 334000,
        baselineMultiplier: null,
        baselineSampleSize: 0,
        additionalMetrics: [],
        fetchedAt: minutesAgo(10),
      },
    ],
    range: {
      publishedFrom: "2026-09-09T00:00:00Z",
      publishedUntil: "2026-10-08T23:59:59Z",
      previousFrom: "2026-08-10T00:00:00Z",
      previousUntil: "2026-09-08T23:59:59Z",
      timezone: "UTC",
      semantics: "lifetime_metrics_by_publication_cohort",
    },
    summary: {
      current: summary,
      previous: summary,
      deltas: {
        postCount: 0,
        views: 0,
        impressions: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: null,
        interactions: 0,
      },
    },
    daily: [{ date: "2026-10-01", summary }],
    consistency: {
      from: "2026-10-01",
      until: "2026-10-08",
      selectedFrom: "2026-09-09",
      selectedUntil: "2026-10-08",
      daily: [{ date: "2026-10-01", postCount: 1, interactions: 918 }],
    },
    comparisons: { accounts: [], providers: [], formats: [] },
    heatmap: {
      timezone: "UTC",
      comparisonProvider: "x",
      postCount: 1,
      minimumSampleSize: 10,
      cells: [],
    },
    followers: [],
    observations: [],
    baseline: {
      windowDays: 90,
      excludeRecentDays: 3,
      minimumSampleSize: 10,
      metric: "interactions",
      comparison: "same_account_median",
    },
    pagination: {
      limit: 100,
      offset: 0,
      nextOffset: null,
      total: 1,
      truncated: false,
    },
    coverage: {
      historyComplete: true,
      lastFetchedAt: minutesAgo(10),
      missingPublicationDateCount: 0,
      historicalSnapshotsAvailable: false,
      unknownPostKindCount: 0,
      unknownContentTypeCount: 0,
    },
  };
}

function accountsFor(shot: Shot) {
  if (shot === "syncing") {
    return [
      account(ACCOUNT_ID, "Masumi", "masumi", snapshot(120, 1)),
      account(SECOND_ID, "Brand page", "brand", snapshot(10, 10), "active"),
    ];
  }
  if (shot === "reconnect") {
    return [
      account(
        ACCOUNT_ID,
        "Masumi",
        "masumi",
        snapshot(120, 120),
        "reauthorization_required",
      ),
    ];
  }
  return [
    account(ACCOUNT_ID, "Masumi", "masumi", snapshot(10, 10)),
    account(SECOND_ID, "Brand page", "brand", snapshot(10, 10)),
  ];
}

function installFetch(shot: Shot) {
  const accounts = accountsFor(shot);
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new Request(input, init).url;
    if (url.includes("/social-performance")) {
      const params = new URL(url, "https://web.test").searchParams;
      const selected =
        accounts.find((row) => row.id === params.get("connectionId")) ??
        accounts[0];
      return Response.json(
        params.get("limit") === "1" ? page(accounts) : page([selected]),
      );
    }
    if (url.includes("/statistics/refresh")) {
      return Response.json({ success: true });
    }
    return original(input, init);
  };
}

function connection(): ProjectSocialConnection {
  return {
    id: ACCOUNT_ID,
    provider: "x",
    externalHandle: "masumi",
    displayName: "Masumi",
    avatarUrl: null,
    status: "active",
    connectedAt: new Date("2026-09-03T10:00:00.000Z"),
    disconnectedAt: null,
  };
}

function App({ shot }: { shot: Shot }) {
  return (
    <div className="bg-background text-foreground min-h-dvh p-8">
      <div className="mx-auto max-w-5xl">
        {shot === "settings" ? (
          <ProjectSocialAccounts
            projectId="project-1"
            connections={[connection()]}
          />
        ) : (
          <SocialPostStatistics projectId="project-1" />
        )}
      </div>
    </div>
  );
}

const params = new URLSearchParams(window.location.search);
const shot = (params.get("shot") ?? "updated") as Shot;
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.dataset.theme = theme;
document.documentElement.style.colorScheme = theme;
installFetch(shot);

const host = document.createElement("div");
document.body.append(host);
createRoot(host).render(
  <NextIntlClientProvider
    locale="en"
    messages={messages}
    timeZone="UTC"
    formats={createFormats("h23")}
  >
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <NuqsTestingAdapter hasMemory>
        <TooltipProvider>
          <App shot={shot} />
        </TooltipProvider>
      </NuqsTestingAdapter>
    </QueryClientProvider>
  </NextIntlClientProvider>,
);
