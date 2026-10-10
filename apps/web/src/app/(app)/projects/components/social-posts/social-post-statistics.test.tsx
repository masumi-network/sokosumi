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
    accounts: [account],
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
    accounts: [account, secondAccount],
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
      <NuqsTestingAdapter searchParams={searchParams} hasMemory>
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
function selectedReads() {
  return mocks.fetch.mock.calls.filter(
    ([url]) =>
      new URL(url, "https://web.test").searchParams.has("connectionId") &&
      !url.includes("/audience"),
  );
}
function openAccountDetails() {
  fireEvent.click(screen.getByText("Account details"));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.refresh.mockReset();
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockImplementation(async (url: string) => {
    const params = new URL(url, "https://web.test").searchParams;
    const selected =
      params.get("connectionId") === secondAccount.id ? secondAccount : account;
    return {
      ok: true,
      json: async () =>
        params.get("limit") === "1"
          ? { ...page(), accounts: [account, secondAccount] }
          : {
              ...page(),
              accounts: [selected],
              posts: [
                {
                  ...post,
                  id: selected.id === secondAccount.id ? "brand-post" : post.id,
                  connectionId: selected.id,
                  provider: selected.provider,
                  text:
                    selected.id === secondAccount.id
                      ? "Brand campaign"
                      : post.text,
                },
              ],
            },
    };
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("SocialPostStatistics account history", () => {
  it("opens the first account after an unfiltered catalogue read, with secondary controls closed", async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      const data = page();
      return {
        ok: true,
        json: async () =>
          new URL(url, "https://web.test").searchParams.get("limit") === "1"
            ? {
                ...data,
                accounts: [account, secondAccount],
                posts: [{ ...post, text: "Combined catalogue row" }],
                summary: {
                  ...data.summary,
                  current: { ...data.summary.current, postCount: 999 },
                },
              }
            : data,
      };
    });
    renderStatistics();
    await screen.findByTestId("social-performance-overview");
    expect(
      screen.getByRole("tab", { name: "Launch account X" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tab", { name: "Brand page Facebook" }),
    ).toHaveAttribute("aria-selected", "false");
    expect(
      new URL(mocks.fetch.mock.calls[0][0], "https://web.test").search,
    ).toBe("?limit=1");
    expect(selectedReads()).toHaveLength(1);
    expect(
      screen.queryByText("Combined catalogue row"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 1 matching posts")).toBeVisible();
    expect(
      new URL(selectedReads()[0][0], "https://web.test").searchParams.get(
        "connectionId",
      ),
    ).toBe(account.id);
    expect(
      screen.queryByRole("tab", { name: "All accounts" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Platform")).not.toBeInTheDocument();
    for (const name of ["More filters", "Account details", "More insights"]) {
      expect(screen.getByText(name).closest("details")).not.toHaveAttribute(
        "open",
      );
    }
    const overview = screen.getByTestId("social-performance-overview");
    expect(
      within(overview).getByRole("figure", { name: "Interactions" }),
    ).toBeVisible();
    // A measured zero still counts as an available metric.
    expect(within(overview).getByText("Views")).toBeVisible();
    expect(within(overview).getByTitle("0")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Account comparison" }),
    ).not.toBeInTheDocument();
  });
  it("preserves a valid bookmarked account ahead of an old provider filter", async () => {
    renderStatistics(
      `?statisticsAccount=${secondAccount.id}&statisticsProvider=x`,
    );
    await screen.findByRole("heading", { name: "Brand page" });
    expect(
      screen.getByRole("tab", { name: "Brand page Facebook" }),
    ).toHaveAttribute("aria-selected", "true");
    const query = new URL(selectedReads()[0][0], "https://web.test")
      .searchParams;
    expect(query.get("connectionId")).toBe(secondAccount.id);
    expect(query.get("provider")).toBe("facebook");
    const exported = new URL(
      screen.getByRole("link", { name: "Export CSV" }).getAttribute("href") ??
        "",
      "https://web.test",
    ).searchParams;
    expect(exported.get("connectionId")).toBe(secondAccount.id);
    expect(exported.get("provider")).toBe("facebook");
    expect(
      screen.queryByRole("heading", { name: "Launch account" }),
    ).not.toBeInTheDocument();
  });
  it("uses the old provider only to choose a valid fallback and never sends an unavailable account", async () => {
    renderStatistics(
      "?statisticsAccount=unavailable&statisticsProvider=facebook&performanceProject=old-project",
    );
    await screen.findByRole("heading", { name: "Brand page" });
    for (const [url] of selectedReads()) {
      const params = new URL(url, "https://web.test").searchParams;
      expect(params.get("connectionId")).toBe(secondAccount.id);
      expect(params.get("provider")).toBe("facebook");
      expect(params.has("projectId")).toBe(false);
    }
  });
  it("keeps every tab while switching scoped payloads and resets account-dependent selections", async () => {
    const user = userEvent.setup();
    const brandPost = {
      ...post,
      id: "brand-post",
      connectionId: secondAccount.id,
      provider: "facebook",
      text: "Brand campaign",
    };
    mocks.fetch.mockImplementation(async (url: string) => {
      const params = new URL(url, "https://web.test").searchParams;
      const isBrand = params.get("connectionId") === secondAccount.id;
      return {
        ok: true,
        json: async () =>
          params.get("limit") === "1"
            ? { ...page(), accounts: [account, secondAccount] }
            : {
                ...page(),
                accounts: [isBrand ? secondAccount : account],
                posts: [isBrand ? brandPost : post],
              },
      };
    });
    renderStatistics("?performanceSearch=campaign");
    await screen.findByText(post.text);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Select to compare/ }),
    );
    fireEvent.click(screen.getByText("More insights"));
    expect(
      screen.getByRole("heading", { name: "Compare posts (1)" }),
    ).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Brand page Facebook" }));
    expect(await screen.findByText(brandPost.text)).toBeVisible();
    expect(screen.getByRole("tab", { name: "Launch account X" })).toBeVisible();
    expect(screen.queryByText(post.text)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Compare posts (1)" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Audience and public benchmarks"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("More insights").closest("details"),
    ).not.toHaveAttribute("open");
    const exportUrl = new URL(
      screen.getByRole("link", { name: "Export CSV" }).getAttribute("href") ??
        "",
      "https://web.test",
    );
    expect(exportUrl.searchParams.get("connectionId")).toBe(secondAccount.id);
    expect(exportUrl.searchParams.get("search")).toBe("campaign");
    await user.click(screen.getByRole("tab", { name: "Launch account X" }));
    await screen.findByText(post.text);
    expect(
      screen.queryByRole("heading", { name: "Compare posts (1)" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Select to compare/ }),
    ).not.toBeChecked();
    expect(
      mocks.fetch.mock.calls.filter(
        ([url]) =>
          new URL(url, "https://web.test").searchParams.get("limit") === "1",
      ),
    ).toHaveLength(1);
  });
  it("clears advanced filters without changing the selected account or broadening its export", async () => {
    renderStatistics(
      `?statisticsAccount=${secondAccount.id}&performanceSearch=launch&performanceFormat=video&performanceTimezone=Europe%2FPrague&publishedFrom=2026-10-01&publishedUntil=2026-10-08`,
    );
    await screen.findByRole("heading", { name: "Brand page" });
    expect(screen.getByText("4 active")).toBeVisible();
    fireEvent.click(screen.getByText("More filters"));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => {
      const params = new URL(selectedReads().at(-1)?.[0], "https://web.test")
        .searchParams;
      expect(params.get("connectionId")).toBe(secondAccount.id);
      expect(params.has("search")).toBe(false);
      expect(params.has("contentType")).toBe(false);
      expect(params.has("publishedFrom")).toBe(false);
      expect(params.get("timezone")).toBe("UTC");
    });
    expect(
      screen.getByRole("tab", { name: "Brand page Facebook" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      new URL(
        screen
          .getByRole("link", { name: "Export spreadsheet" })
          .getAttribute("href") ?? "",
        "https://web.test",
      ).searchParams.get("connectionId"),
    ).toBe(secondAccount.id);
  });
  it("stops a prior account's sync continuation after switching tabs", async () => {
    const user = userEvent.setup();
    let finish: (value: ReturnType<typeof response>) => void = () => {};
    mocks.refresh.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderStatistics();
    await screen.findByText(post.text);
    fireEvent.click(screen.getByRole("button", { name: "Sync account" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("tab", { name: "Brand page Facebook" }));
    await screen.findByRole("heading", { name: "Brand page" });
    await act(async () => finish(response(account, "old-next-page")));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Stop sync" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Resume sync" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync account" })).toBeEnabled();
  });
  it("keeps unsynced accounts selectable and offers account management for an empty scope", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...page(),
        accounts: [{ ...account, statistics: null }],
      }),
    });
    const rendered = renderStatistics();
    expect(
      await screen.findByRole("tab", { name: "Launch account X" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Statistics have not been fetched.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sync account" })).toBeEnabled();
    rendered.unmount();
    mocks.fetch.mockClear();
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...page(), accounts: [], posts: [] }),
    });
    renderStatistics();
    expect(
      await screen.findByRole("link", { name: "Manage accounts" }),
    ).toHaveAttribute("href", "/social?projectId=project-1&tab=accounts");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("social-performance-overview"),
    ).not.toBeInTheDocument();
  });
  it("falls back to Interactions when a filtered X cohort no longer has measured Views", async () => {
    const user = userEvent.setup();
    mocks.fetch.mockImplementation(async (url: string) => {
      const data = page();
      const filtered = new URL(url, "https://web.test").searchParams.has(
        "search",
      );
      return {
        ok: true,
        json: async () =>
          filtered
            ? {
                ...data,
                summary: {
                  ...data.summary,
                  current: {
                    ...data.summary.current,
                    metrics: {
                      ...data.summary.current.metrics,
                      views: {
                        total: null,
                        mean: null,
                        median: null,
                        measuredPostCount: 0,
                      },
                    },
                  },
                },
              }
            : data,
      };
    });
    renderStatistics();
    const trend = await screen.findByLabelText("Chart metric");
    await user.click(trend);
    await user.click(screen.getByRole("option", { name: "Views" }));
    expect(screen.getByRole("figure", { name: "Views" })).toBeVisible();
    fireEvent.click(screen.getByText("More filters"));
    fireEvent.change(screen.getByLabelText("Search posts"), {
      target: { value: "thin sample" },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Chart metric")).toHaveTextContent(
        "Interactions",
      ),
    );
    expect(screen.getByRole("figure", { name: "Interactions" })).toBeVisible();
    expect(
      screen.queryByRole("figure", { name: "Views" }),
    ).not.toBeInTheDocument();
  });
  it("reads workspace aggregates and preserves exact project ownership for account actions and exports", async () => {
    mocks.fetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        new URL(url, "https://web.test").searchParams.has("connectionId")
          ? {
              ...workspacePage(),
              accounts: [account],
              posts: [{ ...post, projectIds: [projectA] }],
            }
          : workspacePage(),
    }));
    mocks.refresh.mockResolvedValue(response(account));
    render(
      <TestQueryProvider>
        <NuqsTestingAdapter
          searchParams={`?performanceProject=${projectA}`}
          hasMemory
        >
          <SocialPostStatistics workspaceId={workspaceId} />
        </NuqsTestingAdapter>
      </TestQueryProvider>,
    );
    await screen.findByText(post.text);
    const read = new URL(selectedReads()[0][0], "https://web.test");
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
    expect(read.searchParams.get("connectionId")).toBe(account.id);
    expect(
      screen.queryByText(/duplicate post copies excluded/),
    ).not.toBeInTheDocument();
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
  it("distinguishes duplicate workspace identities and switches to the selected connection's owning project", async () => {
    const user = userEvent.setup();
    const duplicate = { ...account, id: secondAccount.id };
    const result = { ...workspacePage(), accounts: [account, duplicate] };
    mocks.fetch.mockImplementation(async (url: string) => {
      const params = new URL(url, "https://web.test").searchParams;
      const selected =
        params.get("connectionId") === duplicate.id ? duplicate : account;
      return {
        ok: true,
        json: async () =>
          params.get("limit") === "1"
            ? result
            : {
                ...result,
                accounts: [selected],
                posts: [
                  {
                    ...post,
                    connectionId: selected.id,
                    projectIds: [
                      selected.id === duplicate.id ? projectB : projectA,
                    ],
                  },
                ],
              },
      };
    });
    mocks.refresh.mockResolvedValue(response(duplicate));
    render(
      <TestQueryProvider>
        <NuqsTestingAdapter hasMemory>
          <SocialPostStatistics workspaceId={workspaceId} />
        </NuqsTestingAdapter>
      </TestQueryProvider>,
    );
    await screen.findByTestId("social-performance-overview");
    expect(
      screen.getByRole("tab", { name: "Launch account X · Launch project" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("tab", { name: "Launch account X · Brand project" }),
    );
    await waitFor(() =>
      expect(
        new URL(
          selectedReads().at(-1)?.[0],
          "https://web.test",
        ).searchParams.get("connectionId"),
      ).toBe(duplicate.id),
    );
    const exportParams = new URL(
      screen.getByRole("link", { name: "Export CSV" }).getAttribute("href") ??
        "",
      "https://web.test",
    ).searchParams;
    expect(exportParams.get("connectionId")).toBe(duplicate.id);
    expect(exportParams.get("projectId")).toBe(projectB);
    fireEvent.click(screen.getByRole("button", { name: "Sync account" }));
    await waitFor(() =>
      expect(mocks.refresh).toHaveBeenCalledWith({
        projectId: projectB,
        connectionId: duplicate.id,
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
        url.includes(otherWorkspaceId)
          ? nextPage
          : new URL(url, "https://web.test").searchParams.has("connectionId")
            ? {
                ...workspacePage(),
                accounts: [account],
                posts: [{ ...post, projectIds: [projectA] }],
              }
            : workspacePage(),
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
      expect(query.get("projectId")).not.toBe(projectA);
      expect(query.get("connectionId")).not.toBe(account.id);
    }
    expect(
      onUrlUpdate.mock.lastCall?.[0].searchParams.has("performanceProject"),
    ).toBe(false);
    expect(
      onUrlUpdate.mock.lastCall?.[0].searchParams.get("statisticsAccount"),
    ).toBe(secondAccount.id);
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
            : new URL(url, "https://web.test").searchParams.get(
                  "connectionId",
                ) === account.id
              ? {
                  ...workspacePage(),
                  accounts: [account],
                  posts: [{ ...post, projectIds: [projectA] }],
                }
              : {
                  ...workspacePage(),
                  accounts: [account, { ...secondAccount, provider: "x" }],
                  posts: [canonicalPost],
                },
      };
    });
    render(
      <TestQueryProvider>
        <NuqsTestingAdapter hasMemory>
          <SocialPostStatistics workspaceId={workspaceId} />
        </NuqsTestingAdapter>
      </TestQueryProvider>,
    );
    await screen.findByRole("tab", { name: "Launch account X" });
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
    // In the redesigned UI, mean/median/coverage details are in the title attribute
    // and in a collapsible Details section. Check that the details are available.
    const impressionsCard = within(overview).getByTitle(
      /Mean 240.*median 15.*measured on 500/,
    );
    expect(impressionsCard).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 500 matching posts")).toBeVisible();
    const query = new URL(selectedReads()[0][0], "https://web.test")
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
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
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
    mocks.fetch.mockResolvedValue({
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
    mocks.fetch.mockResolvedValue({
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

  it("shows connected accounts as tabs with selected-account metrics and external read-only posts", async () => {
    renderStatistics();
    expect(await screen.findByText(post.text)).toBeVisible();
    expect(
      screen.getByRole("tab", { name: "Brand page Facebook" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Brand page" }),
    ).not.toBeInTheDocument();
    openAccountDetails();
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
    const url = new URL(selectedReads()[0][0], "https://web.test");
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
    expect(
      screen.getByRole("tab", { name: "Brand page Facebook" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Brand page" }),
    ).not.toBeInTheDocument();
  });
  it("keeps account metrics visible while publication date filters are invalid", async () => {
    renderStatistics("?publishedFrom=2026-10-08&publishedUntil=2026-10-01");
    expect(
      await screen.findByRole("heading", { name: "Launch account" }),
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
    openAccountDetails();
    expect(
      screen.getByText(
        "All history currently available from the platform has been imported.",
      ),
    ).toBeVisible();
  });

  it("loads every cached post page", async () => {
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => page() })
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
      new URL(selectedReads()[1][0], "https://web.test").searchParams.get(
        "offset",
      ),
    ).toBe("100");
  });
  it("syncs the selected account's history pages sequentially and refreshes its cache after each page", async () => {
    mocks.refresh
      .mockResolvedValueOnce(response(account, "provider-page-2"))
      .mockResolvedValueOnce(response(account));
    renderStatistics();
    await screen.findByText(post.text);
    fireEvent.click(screen.getByRole("button", { name: "Sync account" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
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
    ]);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Sync account" }),
      ).toBeEnabled(),
    );
    expect(selectedReads()).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: "Sync all accounts" }),
    ).not.toBeInTheDocument();
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
  it("retains selected cached posts on sync failure without syncing other accounts", async () => {
    mocks.refresh.mockResolvedValueOnce({
      ok: false,
      error: { message: "Denied" },
    });
    renderStatistics();
    await screen.findByText(post.text);
    fireEvent.click(screen.getByRole("button", { name: "Sync account" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
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
    openAccountDetails();
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
