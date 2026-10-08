import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/../messages/en.json";
import { TestQueryProvider } from "@/test/query-provider";
import { SocialPostStatistics } from "./social-post-statistics";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    },
  }),
}));
vi.mock("@/lib/actions/project/action", () => ({
  refreshProjectSocialAccountStatistics: mocks.refresh,
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
const snapshot = {
  metrics: [
    { key: "followers", value: 0, period: "lifetime", unit: null },
    { key: "reach", value: null, period: "days_28", unit: null },
  ],
  fetchedAt: "2026-10-08T08:00:00Z",
  refreshAttemptedAt: "2026-10-08T08:00:00Z",
  error: null,
  historyNextCursor: null,
  historyComplete: false,
  historyFetchedAt: null,
  historyError: null,
  metricWarning: null,
};
const account = {
  id: "11111111-1111-4111-8111-111111111111",
  provider: "x",
  displayName: "Launch account",
  externalHandle: "launch",
  status: "active",
  statistics: snapshot,
  postCount: 1,
};
const secondAccount = {
  ...account,
  id: "22222222-2222-4222-8222-222222222222",
  provider: "facebook",
  displayName: "Brand page",
  externalHandle: "brand",
};
const workspaceId = "33333333-3333-4333-8333-333333333333";
const otherWorkspaceId = "44444444-4444-4444-8444-444444444444";
const projectA = "55555555-5555-4555-8555-555555555555";
const projectB = "66666666-6666-4666-8666-666666666666";
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
function page(offset: number | null = null) {
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
    accounts: [account, secondAccount],
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
      nextOffset: offset,
      total: 1,
      truncated: offset != null,
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
function response(accountValue = account, nextCursor: string | null = null) {
  return {
    ok: true,
    value: {
      account: {
        ...accountValue,
        statistics: {
          ...snapshot,
          historyNextCursor: nextCursor,
          historyComplete: !nextCursor,
        },
      },
      importedPostCount: 1,
    },
  };
}
function workspacePage() {
  const result = page();
  return {
    ...result,
    workspaceId,
    projects: [
      { id: projectA, name: "Launch project", connectionIds: [account.id] },
      {
        id: projectB,
        name: "Brand project",
        connectionIds: [secondAccount.id],
      },
    ],
    posts: result.posts.map((item) => ({
      ...item,
      projectIds: [projectA, projectB],
    })),
    comparisons: {
      ...result.comparisons,
      projects: [{ projectId: projectA, summary: result.summary.current }],
    },
    coverage: {
      ...result.coverage,
      duplicatePostCopiesExcluded: 1,
      deduplicationBasis: "provider_external_post_id",
    },
  };
}
function renderStatistics(searchParams = "") {
  return render(
    <TestQueryProvider>
      <NuqsTestingAdapter searchParams={searchParams}>
        <SocialPostStatistics projectId="project-1" />
      </NuqsTestingAdapter>
    </TestQueryProvider>,
  );
}
function accountCard(name: string) {
  const element = screen.getByRole("heading", { name }).closest("article");
  if (!element) throw new Error("Missing account card");
  return within(element);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.refresh.mockReset();
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => page() });
});
afterEach(() => vi.unstubAllGlobals());

describe("SocialPostStatistics account history", () => {
  it("reads workspace aggregates and preserves exact project ownership for account actions and exports", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => workspacePage(),
    });
    mocks.refresh.mockResolvedValue(response(account));
    render(
      <TestQueryProvider>
        <NuqsTestingAdapter searchParams={`?performanceProject=${projectA}`}>
          <SocialPostStatistics workspaceId={workspaceId} />
        </NuqsTestingAdapter>
      </TestQueryProvider>,
    );
    await screen.findByText(post.text);
    const read = new URL(mocks.fetch.mock.calls[0][0], "https://web.test");
    expect(read.pathname).toBe(
      `/api/workspaces/${workspaceId}/social-performance`,
    );
    expect(read.searchParams.get("projectId")).toBe(projectA);
    const exportUrl = new URL(
      screen.getByRole("link", { name: "Export CSV" }).getAttribute("href") ??
        "",
      "https://web.test",
    );
    expect(exportUrl.pathname).toBe(
      `/api/workspaces/${workspaceId}/social-performance/export`,
    );
    expect(exportUrl.searchParams.get("projectId")).toBe(projectA);
    expect(screen.getByText(/1 duplicate post copies excluded/)).toBeVisible();
    fireEvent.click(
      accountCard("Launch account").getByRole("button", {
        name: "Sync account",
      }),
    );
    await waitFor(() =>
      expect(mocks.refresh).toHaveBeenCalledWith({
        projectId: projectA,
        connectionId: account.id,
        continueHistory: false,
      }),
    );
  });
  it("clears old workspace project/account filters and prevents an in-flight sync from continuing in a new scope", async () => {
    const onUrlUpdate = vi.fn();
    const params = `?performanceProject=${projectA}&statisticsAccount=${account.id}`;
    const nextPage = {
      ...workspacePage(),
      workspaceId: otherWorkspaceId,
      projects: [
        {
          id: projectB,
          name: "Brand project",
          connectionIds: [secondAccount.id],
        },
      ],
      accounts: [secondAccount],
      posts: [],
    };
    mocks.fetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes(otherWorkspaceId) ? nextPage : workspacePage(),
    }));
    let finishSync: (value: ReturnType<typeof response>) => void = () => {};
    mocks.refresh.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSync = resolve;
        }),
    );
    const view = (scope: string) => (
      <TestQueryProvider>
        <NuqsTestingAdapter
          searchParams={params}
          onUrlUpdate={onUrlUpdate}
          hasMemory
        >
          <SocialPostStatistics workspaceId={scope} />
        </NuqsTestingAdapter>
      </TestQueryProvider>
    );
    const rendered = render(view(workspaceId));
    await screen.findByText(post.text);
    fireEvent.click(
      accountCard("Launch account").getByRole("button", {
        name: "Sync account",
      }),
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    rendered.rerender(view(otherWorkspaceId));
    await screen.findByRole("heading", { name: "Brand page" });
    const nextReads = mocks.fetch.mock.calls.filter(([url]) =>
      url.includes(otherWorkspaceId),
    );
    expect(nextReads.length).toBeGreaterThan(0);
    for (const [url] of nextReads) {
      const query = new URL(url, "https://web.test").searchParams;
      expect(query.has("projectId")).toBe(false);
      expect(query.has("connectionId")).toBe(false);
    }
    expect(
      onUrlUpdate.mock.lastCall?.[0].searchParams.has("performanceProject"),
    ).toBe(false);
    expect(
      onUrlUpdate.mock.lastCall?.[0].searchParams.has("statisticsAccount"),
    ).toBe(false);
    await act(async () => finishSync(response(account, "old-next-page")));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("heading", { name: "Launch account" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Stop sync" }),
    ).not.toBeInTheDocument();
    expect(
      accountCard("Brand page").getByRole("button", { name: "Sync account" }),
    ).toBeEnabled();
  });
  it("uses selected account's own cached post IDs for per-post research even when workspace rankings retain another copy", async () => {
    const user = userEvent.setup();
    const ownPost = {
      ...post,
      id: "77777777-7777-4777-8777-777777777777",
      text: "Owned launch post",
    };
    const canonicalPost = {
      ...post,
      id: "88888888-8888-4888-8888-888888888888",
      connectionId: secondAccount.id,
      projectIds: [projectA, projectB],
    };
    let finishPosts: (value: unknown) => void = () => {};
    const mentions = {
      kind: "mentions",
      postId: null,
      contacts: [],
      posts: [],
      nextCursor: null,
      observedAt: "2026-10-08T08:00:00Z",
      samplePostCount: 0,
      oldestPostAt: null,
      newestPostAt: null,
      coverage: "Recent mentions only",
    };
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.startsWith(`/api/projects/${projectA}/social-performance?`)) {
        return {
          ok: true,
          json: () =>
            new Promise((resolve) => {
              finishPosts = resolve;
            }),
        };
      }
      return {
        ok: true,
        json: async () =>
          url.includes("/audience?")
            ? mentions
            : {
                ...workspacePage(),
                accounts: [account, { ...secondAccount, provider: "x" }],
                posts: [canonicalPost],
              },
      };
    });
    render(
      <TestQueryProvider>
        <NuqsTestingAdapter>
          <SocialPostStatistics workspaceId={workspaceId} />
        </NuqsTestingAdapter>
      </TestQueryProvider>,
    );
    await screen.findByText(post.text);
    fireEvent.click(screen.getByText("Audience and public benchmarks"));
    await screen.findByText("Recent mentions only");
    await user.click(
      screen.getByLabelText("Audience view", {
        selector: "#performance-audience-kind",
      }),
    );
    await user.click(
      screen.getByRole("option", { name: "People who liked a post" }),
    );
    await waitFor(() =>
      expect(
        mocks.fetch.mock.calls.some(([url]) =>
          url.startsWith(`/api/projects/${projectA}/social-performance?`),
        ),
      ).toBe(true),
    );
    expect(
      mocks.fetch.mock.calls.some(([url]) => url.includes("kind=likers")),
    ).toBe(false);
    await act(async () =>
      finishPosts({
        ...page(),
        posts: [{ ...ownPost, postKind: "repost", id: "repost-only" }, ownPost],
      }),
    );
    await waitFor(() =>
      expect(
        mocks.fetch.mock.calls.some(([url]) => url.includes("kind=likers")),
      ).toBe(true),
    );
    const audienceUrl = new URL(
      mocks.fetch.mock.calls.find(([url]) => url.includes("kind=likers"))?.[0],
      "https://web.test",
    );
    expect(audienceUrl.pathname).toBe(
      `/api/projects/${projectA}/social-performance/${account.id}/audience`,
    );
    expect(audienceUrl.searchParams.get("postId")).toBe(ownPost.id);
    expect(audienceUrl.searchParams.get("postId")).not.toBe(canonicalPost.id);
    const ownedUrl = new URL(
      mocks.fetch.mock.calls.find(([url]) =>
        url.startsWith(`/api/projects/${projectA}/social-performance?`),
      )?.[0],
      "https://web.test",
    );
    expect(ownedUrl.searchParams.get("connectionId")).toBe(account.id);
    expect(ownedUrl.searchParams.get("sort")).toBe("publishedAt");
    expect(ownedUrl.searchParams.get("publishedFrom")).toBe(
      new Date(page().range.publishedFrom).toISOString(),
    );
  });
  it("uses full-cohort aggregates rather than the visible post page and forwards discovery filters", async () => {
    const result = page();
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...result,
        summary: {
          ...result.summary,
          current: {
            ...result.summary.current,
            postCount: 500,
            metrics: {
              ...result.summary.current.metrics,
              impressions: {
                total: 120000,
                mean: 240,
                median: 15,
                measuredPostCount: 500,
              },
            },
          },
        },
        pagination: { ...result.pagination, total: 500 },
      }),
    });
    renderStatistics(
      "?statisticsProvider=x&performanceTimezone=Europe%2FPrague&performanceSearch=launch&performanceFormat=video&performancePostKind=quotes&performanceSort=engagementRate",
    );
    const overview = await screen.findByTestId("social-performance-overview");
    expect(within(overview).getByTitle("120,000")).toHaveTextContent("120K");
    expect(within(overview).getByText("Mean 240 · median 15")).toBeVisible();
    expect(screen.getByText("Showing 1 of 500 matching posts")).toBeVisible();
    const query = new URL(mocks.fetch.mock.calls[0][0], "https://web.test")
      .searchParams;
    expect(query.get("timezone")).toBe("Europe/Prague");
    expect(query.get("search")).toBe("launch");
    expect(query.get("contentType")).toBe("video");
    expect(query.get("postKind")).toBe("quotes");
    expect(query.get("sort")).toBe("engagementRate");
    expect(
      screen
        .getByRole("link", { name: "Export spreadsheet" })
        .getAttribute("href"),
    ).toContain("format=xlsx");
  });
  it("offers native chart data, table previews and a bounded post comparison", async () => {
    renderStatistics();
    const overview = await screen.findByTestId("social-performance-overview");
    const exact = within(overview).getAllByText("Show exact values")[0];
    expect(exact).toBeVisible();
    fireEvent.click(exact);
    expect(within(overview).getByText("Date")).toBeVisible();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Select to compare/ }),
    );
    expect(
      screen.getByRole("heading", { name: "Compare posts (1)" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    fireEvent.click(screen.getByRole("button", { name: /^Table$/ }));
    const explorer = screen.getByTestId("social-performance-posts");
    expect(
      within(explorer).getByRole("columnheader", { name: "Engagement rate" }),
    ).toBeVisible();
    fireEvent.click(within(explorer).getByText("Show post preview"));
    expect(within(explorer).getByTestId("social-post-preview")).toBeVisible();
  });
  it("loads X audience only after expanding it and benchmarks only after a handle is submitted", async () => {
    mocks.fetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("/audience?")
          ? {
              kind: "mentions",
              postId: null,
              contacts: [],
              posts: [],
              nextCursor: null,
              observedAt: "2026-10-08T08:00:00Z",
              samplePostCount: 0,
              oldestPostAt: null,
              newestPostAt: null,
              coverage: "Recent mentions only",
            }
          : url.includes("/benchmark?")
            ? {
                profile: {
                  id: "public",
                  name: "Public creator",
                  username: "creator",
                  avatarUrl: null,
                  followersCount: 25,
                },
                observedAt: "2026-10-08T08:00:00Z",
                summary: page().summary.current,
                posts: [],
                meanImpressionsToFollowers: null,
                coverage: "Recent public posts only",
              }
            : page(),
    }));
    renderStatistics();
    await screen.findByText(post.text);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Audience and public benchmarks"));
    expect(await screen.findByText("Recent mentions only")).toBeVisible();
    expect(
      mocks.fetch.mock.calls.some(([url]) => url.includes("/benchmark?")),
    ).toBe(false);
    fireEvent.change(
      screen.getByLabelText("X handle", {
        selector: "#performance-benchmark-handle",
      }),
      {
        target: { value: "@creator" },
      },
    );
    fireEvent.submit(
      screen.getByRole("button", { name: "Load benchmark" }).closest("form") ??
        document.body,
    );
    expect(await screen.findByText("Public creator")).toBeVisible();
    const benchmarkUrl = mocks.fetch.mock.calls.find(([url]) =>
      url.includes("/benchmark?"),
    )?.[0];
    expect(
      new URL(benchmarkUrl, "https://web.test").searchParams.get("username"),
    ).toBe("creator");
  });
  it("ranks only sufficiently measured historical posting windows and discloses stale private counters", async () => {
    const result = page();
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...result,
        heatmap: {
          ...result.heatmap,
          cells: [
            {
              weekday: 0,
              hour: 9,
              postCount: 9,
              measuredPostCount: 9,
              meanInteractions: 999,
              meanEngagementRate: 10,
            },
            {
              weekday: 1,
              hour: 12,
              postCount: 20,
              measuredPostCount: 10,
              meanInteractions: 20,
              meanEngagementRate: 2,
            },
            {
              weekday: 3,
              hour: 15,
              postCount: 15,
              measuredPostCount: 15,
              meanInteractions: 5,
              meanEngagementRate: 1,
            },
          ],
        },
        posts: [
          {
            ...post,
            additionalMetrics: [
              {
                key: "url_clicks",
                value: 9,
                period: "lifetime:2026-09-30T08:00:00Z",
                unit: null,
              },
            ],
          },
        ],
      }),
    });
    renderStatistics();
    const heading = await screen.findByRole("heading", {
      name: "Highest observed posting windows",
    });
    const ranking = within(heading.parentElement ?? document.body);
    const rows = ranking.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Tue 12:00");
    expect(rows[1]).toHaveTextContent("Thu 15:00");
    expect(ranking.queryByText("999")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("More metrics"));
    expect(screen.getByText(/Lifetime counter measured Sep 30/)).toBeVisible();
  });
  it("deduplicates incoming evidence across pages, stops repeated cursors and exports only loaded pages", async () => {
    const contact = {
      id: "reply-author",
      name: "Reply author",
      username: "reader",
      description: null,
      location: null,
      avatarUrl: null,
      followersCount: 50,
      interactions: 1,
      replies: 1,
      quotes: 0,
      mentions: 0,
      likes: null,
      reposts: null,
    };
    const sample = {
      kind: "mentions",
      postId: null,
      contacts: [contact],
      posts: [
        {
          author: contact,
          post: {
            ...post,
            externalId: "reply-1",
            text: "An incoming reply",
            url: "https://x.com/reader/status/456",
          },
          interactionType: "reply",
        },
      ],
      nextCursor: "repeat",
      observedAt: "2026-10-08T08:00:00Z",
      samplePostCount: 1,
      oldestPostAt: null,
      newestPostAt: null,
      coverage: "Recent mentions sample",
    };
    const createUrl = vi.fn(() => "blob:sample");
    const revokeUrl = vi.fn();
    const BrowserURL = URL;
    vi.stubGlobal(
      "URL",
      class extends BrowserURL {
        static createObjectURL = createUrl;
        static revokeObjectURL = revokeUrl;
      },
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    mocks.fetch.mockImplementation(async (url: string) =>
      url.endsWith("/audience/export")
        ? new Response("csv")
        : {
            ok: true,
            json: async () => (url.includes("/audience?") ? sample : page()),
          },
    );
    renderStatistics();
    await screen.findByText(post.text);
    fireEvent.click(screen.getByText("Audience and public benchmarks"));
    expect(await screen.findByText("An incoming reply")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Load more contacts" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Load more contacts" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getAllByText("An incoming reply")).toHaveLength(1);
    const row = screen
      .getAllByText("Reply author")
      .map((element) => element.closest("tr"))
      .find(Boolean);
    expect(row?.querySelectorAll("td")[3]).toHaveTextContent("1");
    fireEvent.click(
      screen.getByRole("button", { name: "Export loaded audience (CSV)" }),
    );
    await waitFor(() => expect(createUrl).toHaveBeenCalledTimes(1));
    const exportCall = mocks.fetch.mock.calls.find(([url]) =>
      url.endsWith("/audience/export"),
    );
    expect(JSON.parse(exportCall?.[1].body)).toEqual({
      format: "csv",
      pages: [sample, sample],
    });
    expect(
      mocks.fetch.mock.calls.filter(([url]) => url.includes("/audience?"))
        .length,
    ).toBe(2);
    expect(revokeUrl).toHaveBeenCalledWith("blob:sample");
    click.mockRestore();
  });
  it("searches public content only on submission and forwards sample filters", async () => {
    mocks.fetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("/discovery?")
          ? {
              posts: [],
              nextCursor: null,
              observedAt: "2026-10-08T08:00:00Z",
              publishedFrom: "2026-10-01T08:01:00Z",
              publishedUntil: "2026-10-08T08:00:00Z",
              samplePostCount: 20,
              matchedPostCount: 0,
              missingCounterPostCount: 5,
              coverage: "Seven-day public sample",
            }
          : url.includes("/audience?")
            ? {
                kind: "mentions",
                postId: null,
                contacts: [],
                posts: [],
                nextCursor: null,
                observedAt: "2026-10-08T08:00:00Z",
                samplePostCount: 0,
                oldestPostAt: null,
                newestPostAt: null,
                coverage: "Recent mentions only",
              }
            : page(),
    }));
    renderStatistics();
    await screen.findByText(post.text);
    fireEvent.click(screen.getByText("Audience and public benchmarks"));
    await screen.findByText("Recent mentions only");
    expect(
      mocks.fetch.mock.calls.some(([url]) => url.includes("/discovery?")),
    ).toBe(false);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Topic or keyword" }),
      { target: { value: "design" } },
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Language code" }), {
      target: { value: "en" },
    });
    fireEvent.click(screen.getByText("Dates and minimum counters"));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Minimum likes" }),
      { target: { value: "10" } },
    );
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Search public posts" })
        .closest("form") ?? document.body,
    );
    expect(await screen.findByText("Seven-day public sample")).toBeVisible();
    const searchUrl = mocks.fetch.mock.calls.find(([url]) =>
      url.includes("/discovery?"),
    )?.[0];
    const query = new URL(searchUrl, "https://web.test").searchParams;
    expect(query.get("topic")).toBe("design");
    expect(query.get("language")).toBe("en");
    expect(query.get("minLikes")).toBe("10");
    expect(
      screen.getByText(/5 rows excluded for missing counters/),
    ).toBeVisible();
  });
  it("pins the public discovery sample range across cursors and retains it when retention expires", async () => {
    const from = "2026-10-01T08:01:00.000Z";
    const until = "2026-10-08T08:00:00.000Z";
    mocks.fetch.mockImplementation(async (url: string) => {
      if (
        url.includes("/discovery?") &&
        new URL(url, "https://web.test").searchParams.has("cursor")
      )
        return { ok: false, status: 422 };
      return {
        ok: true,
        json: async () =>
          url.includes("/discovery?")
            ? {
                posts: [],
                nextCursor: "page2",
                observedAt: until,
                publishedFrom: from,
                publishedUntil: until,
                samplePostCount: 20,
                matchedPostCount: 0,
                missingCounterPostCount: 0,
                coverage: "Original seven-day sample",
              }
            : url.includes("/audience?")
              ? {
                  kind: "mentions",
                  contacts: [],
                  posts: [],
                  nextCursor: null,
                  observedAt: until,
                  samplePostCount: 0,
                  oldestPostAt: null,
                  newestPostAt: null,
                  coverage: "Recent mentions only",
                }
              : page(),
      };
    });
    renderStatistics();
    await screen.findByText(post.text);
    fireEvent.click(screen.getByText("Audience and public benchmarks"));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Topic or keyword" }),
      { target: { value: "design" } },
    );
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Search public posts" })
        .closest("form") ?? document.body,
    );
    await screen.findByText("Original seven-day sample");
    fireEvent.click(screen.getByRole("button", { name: "Load more posts" }));
    expect(
      await screen.findByText(
        en.App.Projects.SocialPosts.statistics.performance.researchFailed,
      ),
    ).toBeVisible();
    const requests = mocks.fetch.mock.calls
      .filter(([url]) => url.includes("/discovery?"))
      .map(([url]) => new URL(url, "https://web.test").searchParams);
    expect(requests).toHaveLength(2);
    expect(requests[0].has("publishedFrom")).toBe(false);
    expect(requests[1].get("publishedFrom")).toBe(from);
    expect(requests[1].get("publishedUntil")).toBe(until);
    expect(requests[1].get("cursor")).toBe("page2");
    expect(screen.getByText("Original seven-day sample")).toBeVisible();
  });
  it("keeps zero distinct from unavailable and shows exact values for compact counts", async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...page(),
        posts: [{ ...post, metrics: { ...post.metrics, impressions: 15000 } }],
      }),
    });
    renderStatistics();
    const preview = await screen.findByTestId("social-post-preview");
    const card = preview.closest("article");
    if (!card) throw new Error("Missing performance card");
    const metrics = within(card);
    expect(metrics.getAllByTitle("Unavailable")).toHaveLength(2);
    for (const value of metrics.getAllByTitle("Unavailable")) {
      expect(value).toHaveTextContent("Unavailable");
    }
    expect(metrics.getByTitle("0")).toHaveTextContent("0");
    expect(metrics.getByTitle("15,000")).toHaveTextContent("15K");
    expect(metrics.getByText("Launch account")).toBeVisible();
    expect(metrics.getByText("Launch account")).not.toHaveClass("truncate");
  });
  it("uses the platform preview for imported posts without draft-only media or time hints", async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...page(),
        accounts: [{ ...account, provider: "instagram" }],
        posts: [{ ...post, provider: "instagram", publishedAt: null }],
      }),
    });
    renderStatistics();
    const preview = await screen.findByTestId("social-post-preview");
    expect(preview).toHaveAttribute("data-provider", "instagram");
    expect(within(preview).getAllByText("launch")).toHaveLength(2);
    expect(within(preview).getByText(post.text)).toBeVisible();
    expect(
      within(preview).getByText("Publication date unavailable"),
    ).toBeVisible();
    expect(
      within(preview).queryByText(en.App.Projects.SocialPosts.preview.now),
    ).not.toBeInTheDocument();
    expect(
      within(preview).queryByText(
        en.App.Projects.SocialPosts.preview.instagram.mediaRequired,
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: en.App.Projects.SocialPosts.statistics.openPost,
      }),
    ).toHaveAttribute("href", post.url);
    expect(
      within(preview.closest("article") ?? preview).getByText(
        "Likes / reactions",
      ),
    ).toBeVisible();
  });
  it("shows a retryable error for a successful HTTP response containing an error body", async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: "Statistics unavailable" }),
    });
    renderStatistics();
    expect(
      await screen.findByText(
        en.App.Projects.SocialPosts.statistics.loadFailed,
      ),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", {
        name: en.App.Projects.SocialPosts.statistics.retry,
      }),
    );
    expect(await screen.findByText(post.text)).toBeVisible();
  });

  it("shows every connected account, zero, unavailable, metric periods and external read-only posts", async () => {
    renderStatistics();
    expect(await screen.findByText(post.text)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Brand page" })).toBeVisible();
    expect(accountCard("Launch account").getByText("0")).toBeVisible();
    expect(
      accountCard("Launch account").getByText("Unavailable"),
    ).toBeVisible();
    expect(accountCard("Launch account").getByText("Lifetime")).toBeVisible();
    expect(
      accountCard("Launch account").getByText("Last 28 days"),
    ).toBeVisible();
    expect(screen.getByText("Link clicks")).not.toBeVisible();
    fireEvent.click(screen.getByText("More metrics"));
    expect(screen.getByText("Link clicks")).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: en.App.Projects.SocialPosts.statistics.openPost,
      }),
    ).toHaveAttribute("href", post.url);
    expect(
      screen.queryByRole("button", { name: /edit|schedule|post now/i }),
    ).not.toBeInTheDocument();
  });
  it("filters cached posts by account, platform and UTC dates while retaining the account overview", async () => {
    renderStatistics(
      `?statisticsProvider=x&statisticsAccount=${account.id}&publishedFrom=2026-10-01&publishedUntil=2026-10-01`,
    );
    await screen.findByText(post.text);
    const url = new URL(mocks.fetch.mock.calls[0][0], "https://web.test");
    expect(url.searchParams.get("provider")).toBe("x");
    expect(url.searchParams.get("connectionId")).toBe(account.id);
    expect(url.searchParams.get("publishedFrom")).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(url.searchParams.get("publishedUntil")).toBe(
      "2026-10-01T23:59:59.999Z",
    );
    const { createTestFormatter } = await import("@/test/intl-formatter");
    const reader = createTestFormatter({ timeZone: "America/Los_Angeles" });
    expect(
      screen.getByText(
        reader.dateTime(new Date(post.publishedAt), "dateTime", {
          timeZone: "UTC",
          timeZoneName: "short",
        }),
        { exact: false },
      ),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Brand page" })).toBeVisible();
  });
  it("keeps account metrics visible while publication date filters are invalid", async () => {
    renderStatistics("?publishedFrom=2026-10-08&publishedUntil=2026-10-01");
    expect(
      await screen.findByRole("heading", { name: "Brand page" }),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose an ordered publication range",
    );
    expect(screen.queryByText(post.text)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Export spreadsheet" }),
    ).toBeDisabled();
    const url = new URL(mocks.fetch.mock.calls[0][0], "https://web.test");
    expect(url.searchParams.has("publishedFrom")).toBe(false);
    expect(url.searchParams.has("publishedUntil")).toBe(false);
  });

  it("shows missing post metrics as a warning without claiming missing history", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...page(),
        accounts: [
          {
            ...account,
            statistics: {
              ...snapshot,
              historyComplete: true,
              metricWarning: "Some post insights unavailable",
            },
          },
        ],
      }),
    });
    renderStatistics();
    await screen.findByText(post.text);
    expect(screen.getByText(/Some post metrics are unavailable/)).toBeVisible();
    expect(
      screen.getByText(
        "All history currently available from the platform has been imported.",
      ),
    ).toBeVisible();
  });

  it("loads every cached post page", async () => {
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => page(100) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...page(),
          posts: [{ ...post, id: "post-2", text: "Second external post" }],
        }),
      });
    renderStatistics();
    fireEvent.click(
      await screen.findByRole("button", { name: "Load more posts" }),
    );
    expect(await screen.findByText("Second external post")).toBeVisible();
    expect(
      new URL(
        mocks.fetch.mock.calls[1][0],
        "https://web.test",
      ).searchParams.get("offset"),
    ).toBe("100");
  });
  it("syncs all account history pages sequentially and refreshes visible cache after each page", async () => {
    mocks.refresh
      .mockResolvedValueOnce(response(account, "provider-page-2"))
      .mockResolvedValueOnce(response(account))
      .mockResolvedValueOnce(response(secondAccount));
    renderStatistics();
    await screen.findByText(post.text);
    fireEvent.click(screen.getByRole("button", { name: "Sync all accounts" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(3));
    expect(mocks.refresh.mock.calls.map(([params]) => params)).toEqual([
      {
        projectId: "project-1",
        connectionId: account.id,
        continueHistory: false,
      },
      {
        projectId: "project-1",
        connectionId: account.id,
        continueHistory: true,
      },
      {
        projectId: "project-1",
        connectionId: secondAccount.id,
        continueHistory: false,
      },
    ]);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Sync all accounts" }),
      ).toBeEnabled(),
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
  });
  it("continues history when account metrics are unavailable but a next page exists", async () => {
    const result = response(account, "provider-page-2");
    mocks.refresh
      .mockResolvedValueOnce({
        ...result,
        value: {
          ...result.value,
          account: {
            ...result.value.account,
            statistics: {
              ...result.value.account.statistics,
              error: "Account insights unavailable",
              metricWarning: "Some post metrics unavailable",
            },
          },
        },
      })
      .mockResolvedValueOnce(response(account));
    renderStatistics();
    await screen.findByText(post.text);
    fireEvent.click(
      accountCard("Launch account").getByRole("button", {
        name: "Sync account",
      }),
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
  });
  it("resumes an incomplete retained history cursor", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...page(),
        accounts: [
          {
            ...account,
            statistics: { ...snapshot, historyNextCursor: "retained-cursor" },
          },
        ],
      }),
    });
    mocks.refresh.mockResolvedValue(response(account));
    renderStatistics();
    fireEvent.click(await screen.findByRole("button", { name: "Resume sync" }));
    await waitFor(() =>
      expect(mocks.refresh).toHaveBeenCalledWith({
        projectId: "project-1",
        connectionId: account.id,
        continueHistory: true,
      }),
    );
  });
  it("retains the returned resume cursor when a follow-up cache read fails", async () => {
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => page() })
      .mockResolvedValue({ ok: false });
    mocks.refresh
      .mockResolvedValueOnce(response(account, "retained-next-page"))
      .mockResolvedValueOnce({ ok: false, error: { message: "Rate limited" } });
    renderStatistics();
    await screen.findByText(post.text);
    fireEvent.click(
      accountCard("Launch account").getByRole("button", {
        name: "Sync account",
      }),
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
    expect(
      await accountCard("Launch account").findByRole("button", {
        name: "Resume sync",
      }),
    ).toBeEnabled();
    expect(screen.getByText(post.text)).toBeVisible();
  });

  it("stops after the in-flight page when canceled", async () => {
    let resolvePage: (value: ReturnType<typeof response>) => void = () => {};
    mocks.refresh.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePage = resolve;
        }),
    );
    renderStatistics();
    await screen.findByText(post.text);
    fireEvent.click(
      accountCard("Launch account").getByRole("button", {
        name: "Sync account",
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Stop sync" }));
    await act(async () => resolvePage(response(account, "next-page")));
    await waitFor(() =>
      expect(
        accountCard("Launch account").getByRole("button", {
          name: "Sync account",
        }),
      ).toBeEnabled(),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it("does not request another page after unmount", async () => {
    let resolvePage: (value: ReturnType<typeof response>) => void = () => {};
    mocks.refresh.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePage = resolve;
        }),
    );
    const rendered = renderStatistics();
    await screen.findByText(post.text);
    fireEvent.click(
      accountCard("Launch account").getByRole("button", {
        name: "Sync account",
      }),
    );
    rendered.unmount();
    await act(async () => resolvePage(response(account, "next-page")));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it("retains cached posts on account failure and continues other accounts", async () => {
    mocks.refresh
      .mockResolvedValueOnce({ ok: false, error: { message: "Denied" } })
      .mockResolvedValueOnce(response(secondAccount));
    renderStatistics();
    await screen.findByText(post.text);
    fireEvent.click(screen.getByRole("button", { name: "Sync all accounts" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
    expect(
      accountCard("Launch account").getByText(/Cached results are retained/),
    ).toBeVisible();
    expect(screen.getByText(post.text)).toBeVisible();
  });
  it("shows provider history limitations without claiming completion and disables reauthorization-required sync", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...page(),
        accounts: [
          {
            ...account,
            status: "reauthorization_required",
            statistics: {
              ...snapshot,
              historyError: "Platform exposes only the most recent posts",
            },
          },
        ],
      }),
    });
    renderStatistics();
    await screen.findByText(post.text);
    expect(
      screen.getByText("Platform exposes only the most recent posts"),
    ).toBeVisible();
    expect(
      screen.queryByText(
        "All history currently available from the platform has been imported.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync account" })).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "Manage accounts" }),
    ).toHaveAttribute("href", "/social?projectId=project-1&tab=accounts");
  });
});
