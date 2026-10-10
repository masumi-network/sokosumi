/**
 * Server-driven background sync tests for social account performance.
 * Tests the automatic sync triggered on connect/reauth and tab open,
 * plus scheduler behavior (priority, backoff, reauth handling).
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/../messages/en.json";
import { TestQueryProvider } from "@/test/query-provider";
import { SocialPostStatistics } from "./social-post-statistics";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refreshAction: vi.fn(),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    },
  }),
}));

vi.mock("@/lib/actions/project/social-performance-refresh.action", () => ({
  refreshSocialAccountPerformance: mocks.refreshAction,
}));

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  const { createTranslator } =
    await vi.importActual<typeof import("next-intl")>("next-intl");
  return {
    useFormatter: () =>
      createTestFormatter({ timeZone: "America/Los_Angeles" }),
    useTranslations: (
      namespace:
        | "App.Projects.SocialPosts.statistics"
        | "App.Projects.SocialPosts.preview",
    ) =>
      createTranslator({
        locale: "en",
        messages: en,
        namespace,
      }),
  };
});

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

const snapshot = {
  metrics: [
    { key: "followers", value: 0, period: "lifetime", unit: null },
    { key: "reach", value: null, period: "days_28", unit: null },
  ],
  fetchedAt: minutesAgo(10),
  refreshAttemptedAt: minutesAgo(10),
  error: null,
  historyNextCursor: null,
  historyComplete: false,
  historyFetchedAt: null,
  historyError: null,
  metricWarning: null,
};

function accountSync(
  status:
    | "fresh"
    | "stale"
    | "queued"
    | "running"
    | "reauth_required"
    | "partial",
  extras: Record<string, unknown> = {},
) {
  return {
    status,
    mayAutoRequest: status === "stale",
    dataVersion: status,
    dataFetchedAt: snapshot.fetchedAt,
    headFetchedAt: snapshot.fetchedAt,
    lastError: null,
    partialWarnings: [],
    ...extras,
  };
}

const account = {
  id: "11111111-1111-4111-8111-111111111111",
  provider: "x",
  displayName: "Launch account",
  externalHandle: "launch",
  status: "active",
  statistics: snapshot,
  postCount: 1,
  sync: accountSync("fresh"),
};

const secondAccount = {
  ...account,
  id: "22222222-2222-4222-8222-222222222222",
  provider: "facebook",
  displayName: "Brand page",
  externalHandle: "brand",
};

const post = {
  id: "post-1",
  connectionId: account.id,
  provider: "x",
  externalId: "outside-123",
  publishedAt: "2026-10-01T00:15:00Z",
  text: "Published outside Sokosumi",
  url: "https://x.com/launch/status/123",
  metrics: {
    views: 0,
    impressions: null,
    likes: 5,
    comments: null,
    shares: 1,
    saves: null,
  },
  contentType: "text",
  postKind: "post",
  media: [],
  interactions: null,
  engagementRate: null,
  engagementDenominator: null,
  baselineMultiplier: null,
  baselineSampleSize: 0,
  additionalMetrics: [
    { key: "url_clicks", value: 9, period: "lifetime", unit: null },
  ],
  fetchedAt: "2026-10-08T08:00:00Z",
};

function page(accounts = [account]) {
  const metric = (total: number | null) => ({
    total,
    mean: total,
    median: total,
    measuredPostCount: total == null ? 0 : 1,
  });
  const summary = {
    postCount: 1,
    measuredPostCount: 0,
    metrics: {
      views: metric(0),
      impressions: metric(null),
      likes: metric(5),
      comments: metric(null),
      shares: metric(1),
      saves: metric(null),
    },
    interactions: metric(null),
    engagementRates: [],
    additionalMetrics: [],
  };
  return {
    accounts,
    posts: [post],
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
        impressions: null,
        likes: 0,
        comments: null,
        shares: 0,
        saves: null,
        interactions: null,
      },
    },
    daily: [{ date: "2026-10-01", summary }],
    consistency: {
      from: "2026-10-01",
      until: "2026-10-08",
      selectedFrom: "2026-09-09",
      selectedUntil: "2026-10-08",
      daily: [{ date: "2026-10-01", postCount: 1, interactions: null }],
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
      historyComplete: false,
      lastFetchedAt: "2026-10-08T08:00:00Z",
      missingPublicationDateCount: 0,
      historicalSnapshotsAvailable: false,
      unknownPostKindCount: 0,
      unknownContentTypeCount: 0,
    },
  };
}

function renderStatistics(searchParams = "") {
  return render(
    <TestQueryProvider>
      <NuqsTestingAdapter searchParams={searchParams} hasMemory>
        <SocialPostStatistics projectId="project-1" />
      </NuqsTestingAdapter>
    </TestQueryProvider>,
  );
}

function mockPages(accounts: Array<typeof account>) {
  mocks.fetch.mockImplementation(async (url: string) => {
    const params = new URL(url, "https://web.test").searchParams;
    const selected =
      accounts.find((row) => row.id === params.get("connectionId")) ??
      accounts[0] ??
      account;
    return {
      ok: true,
      json: async () =>
        params.get("limit") === "1" ? page(accounts) : page([selected]),
    };
  });
}

function accountCombobox() {
  return screen.getByRole("combobox", { name: /connected accounts/i });
}

async function selectAccount(
  user: ReturnType<typeof userEvent.setup>,
  accountName: string,
) {
  await user.click(accountCombobox());
  const option = await screen.findByRole("option", {
    name: new RegExp(accountName, "i"),
  });
  await user.click(option);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockReset();
  mocks.refreshAction.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
  mockPages([account, secondAccount]);
  mocks.refreshAction.mockResolvedValue({
    ok: true,
    value: { enqueued: true },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("SocialPostStatistics server-driven sync", () => {
  it("shows 'Syncing...' indicator when account data is stale on mount", async () => {
    const staleAccount = {
      ...account,
      statistics: {
        ...snapshot,
        fetchedAt: minutesAgo(120),
        refreshAttemptedAt: minutesAgo(120),
      },
      sync: accountSync("stale", {
        dataFetchedAt: minutesAgo(120),
        headFetchedAt: minutesAgo(120),
      }),
    };
    mockPages([staleAccount]);

    renderStatistics();

    expect(await screen.findByText("Syncing…")).toBeVisible();
    expect(screen.getByText(post.text)).toBeVisible();
  });

  it("renders stored posts while a refresh is queued and does not stack another request", async () => {
    const queuedAccount = {
      ...account,
      statistics: {
        ...snapshot,
        fetchedAt: minutesAgo(120),
        refreshAttemptedAt: minutesAgo(120),
      },
      sync: accountSync("queued", { dataVersion: "queued-1" }),
    };
    mockPages([queuedAccount]);

    renderStatistics();

    expect(await screen.findByText(post.text)).toBeVisible();
    expect(await screen.findByText("Syncing…")).toBeVisible();
    expect(mocks.refreshAction).not.toHaveBeenCalled();
  });

  it("does not show syncing indicator when account data is fresh", async () => {
    mockPages([account]);

    renderStatistics();

    await screen.findByText(post.text);
    expect(screen.queryByText("Syncing…")).not.toBeInTheDocument();
  });

  it("triggers background refresh when switching to stale account", async () => {
    const user = userEvent.setup();
    const freshFirst = {
      ...account,
      statistics: {
        ...snapshot,
        fetchedAt: minutesAgo(10),
        refreshAttemptedAt: minutesAgo(10),
      },
    };
    const staleSecond = {
      ...secondAccount,
      statistics: {
        ...snapshot,
        fetchedAt: minutesAgo(120),
        refreshAttemptedAt: minutesAgo(120),
      },
      sync: accountSync("stale", {
        dataFetchedAt: minutesAgo(120),
        headFetchedAt: minutesAgo(120),
      }),
    };
    mockPages([freshFirst, staleSecond]);

    renderStatistics();

    await screen.findByText(post.text);
    expect(screen.queryByText("Syncing…")).not.toBeInTheDocument();

    await selectAccount(user, "Brand page");

    expect(await screen.findByText("Syncing…")).toBeVisible();
    await waitFor(() => {
      expect(mocks.refreshAction).toHaveBeenCalledWith({
        projectId: "project-1",
        connectionId: staleSecond.id,
      });
    });
  });

  it("shows reauthorization status for accounts needing reauth", async () => {
    const reauthAccount = {
      ...account,
      status: "reauthorization_required" as const,
      statistics: {
        ...snapshot,
        error: "Authentication required",
      },
    };
    mockPages([reauthAccount as never]);

    renderStatistics();

    await screen.findByText(post.text);
    expect(
      screen.getByText("Reconnect this account before syncing statistics."),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Manage accounts" })).toBeVisible();
  });

  it("does not trigger refresh for reauthorization-required accounts", async () => {
    const reauthAccount = {
      ...account,
      status: "reauthorization_required" as const,
      statistics: {
        ...snapshot,
        fetchedAt: minutesAgo(120),
        refreshAttemptedAt: minutesAgo(120),
        error: "Authentication required",
      },
    };
    mockPages([reauthAccount as never]);

    renderStatistics();

    await screen.findByText(post.text);
    expect(
      screen.getByText("Reconnect this account before syncing statistics."),
    ).toBeVisible();
    expect(screen.queryByText("Syncing…")).not.toBeInTheDocument();
    expect(mocks.refreshAction).not.toHaveBeenCalled();
  });

  it("shows account statistics even when history is incomplete", async () => {
    const incompleteAccount = {
      ...account,
      statistics: {
        ...snapshot,
        historyComplete: false,
        historyNextCursor: "page-2-cursor",
      },
    };
    mockPages([incompleteAccount as never]);

    renderStatistics();

    await screen.findByText(post.text);
    const overview = screen.getByTestId("social-performance-overview");
    expect(
      within(overview).getByRole("figure", { name: "Interactions" }),
    ).toBeVisible();
  });

  it("displays post history even with account metric errors", async () => {
    const errorAccount = {
      ...account,
      statistics: {
        ...snapshot,
        error: "Account insights unavailable",
        historyComplete: true,
      },
    };
    mockPages([errorAccount as never]);

    renderStatistics();

    expect(await screen.findByText(post.text)).toBeVisible();
    expect(screen.getByText("Some account metrics missing")).toBeVisible();
  });

  it("handles account switch during background refresh gracefully", async () => {
    const user = userEvent.setup();
    const staleFirst = {
      ...account,
      statistics: {
        ...snapshot,
        fetchedAt: minutesAgo(120),
        refreshAttemptedAt: minutesAgo(120),
      },
      sync: accountSync("stale", {
        dataFetchedAt: minutesAgo(120),
        headFetchedAt: minutesAgo(120),
      }),
    };
    const staleSecond = {
      ...secondAccount,
      statistics: {
        ...snapshot,
        fetchedAt: minutesAgo(120),
        refreshAttemptedAt: minutesAgo(120),
      },
      sync: accountSync("stale", {
        dataFetchedAt: minutesAgo(120),
        headFetchedAt: minutesAgo(120),
      }),
    };
    mockPages([staleFirst, staleSecond]);

    renderStatistics();

    await screen.findByText("Syncing…");
    await selectAccount(user, "Brand page");

    expect(await screen.findByText("Syncing…")).toBeVisible();
    await waitFor(() => {
      expect(mocks.refreshAction).toHaveBeenCalledTimes(2);
    });
  });

  it("does not enqueue again while a refresh was attempted in the last 5 minutes", async () => {
    const inFlight = {
      ...account,
      statistics: {
        ...snapshot,
        fetchedAt: minutesAgo(120),
        refreshAttemptedAt: minutesAgo(1),
      },
      sync: accountSync("running"),
    };
    mockPages([inFlight]);

    renderStatistics();

    expect(await screen.findByText("Syncing…")).toBeVisible();
    expect(mocks.refreshAction).not.toHaveBeenCalled();
  });
});
