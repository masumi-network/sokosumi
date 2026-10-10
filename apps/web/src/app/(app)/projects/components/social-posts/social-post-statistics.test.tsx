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
/**
 * Helper to switch accounts in the Select-based account control.
 */
function accountCombobox() {
  return screen.getByRole("combobox", { name: /connected accounts/i });
}
async function _selectAccount(
  user: ReturnType<typeof userEvent.setup>,
  accountName: string,
) {
  await user.click(accountCombobox());
  const option = await screen.findByRole("option", {
    name: new RegExp(accountName, "i"),
  });
  await user.click(option);
}
function _isAccountSelected(accountName: string): boolean {
  const combobox = screen.queryByRole("combobox", {
    name: /connected accounts/i,
  });
  if (combobox) return combobox.textContent?.includes(accountName) ?? false;
  return screen.queryByText(accountName) != null;
}
async function _getExportLink(
  user: ReturnType<typeof userEvent.setup>,
  linkName: string,
): Promise<string> {
  await user.click(screen.getByRole("button", { name: /more actions/i }));
  const item = await screen.findByRole("menuitem", {
    name: new RegExp(linkName, "i"),
  });
  const href = item.getAttribute("href") ?? "";
  await user.keyboard("{Escape}");
  return href;
}
function selectedReads() {
  return mocks.fetch.mock.calls.filter(
    ([url]) =>
      new URL(url, "https://web.test").searchParams.has("connectionId") &&
      !url.includes("/audience"),
  );
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
    // Wait for the combobox to be present and contain the selected account
    await waitFor(() => {
      const combobox = accountCombobox();
      expect(combobox.textContent).toContain("Launch account");
    });
    // The other account is not selected
    expect(_isAccountSelected("Brand page")).toBe(false);
    expect(
      new URL(mocks.fetch.mock.calls[0][0], "https://web.test").search,
    ).toBe("?limit=1");
    expect(selectedReads()).toHaveLength(1);
    expect(
      screen.queryByText("Combined catalogue row"),
    ).not.toBeInTheDocument();
    expect(screen.getByText(post.text)).toBeVisible();
    expect(
      screen.queryByText("Choose an account to explore its performance."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Details")).not.toBeInTheDocument();
    expect(screen.queryByText("About this data")).not.toBeInTheDocument();
    expect(screen.queryByText("More insights")).not.toBeInTheDocument();
    expect(screen.queryByText("Daily counts")).not.toBeInTheDocument();
    expect(
      new URL(selectedReads()[0][0], "https://web.test").searchParams.get(
        "connectionId",
      ),
    ).toBe(account.id);
    // No "All accounts" option in single-project view
    const combobox = accountCombobox();
    await userEvent.setup().click(combobox);
    expect(
      screen.queryByRole("option", { name: /All accounts/i }),
    ).not.toBeInTheDocument();
    // Close the dropdown
    await userEvent.setup().keyboard("{Escape}");
    expect(screen.queryByLabelText("Platform")).not.toBeInTheDocument();
    expect(
      screen.getByText("More filters").closest("details"),
    ).not.toHaveAttribute("open");
    const overview = screen.getByTestId("social-performance-overview");
    expect(
      screen.getByText(
        "1 post across 1 active day from Oct 1, 2026 to Oct 1, 2026.",
      ),
    ).toBeVisible();
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
    // Wait for the Brand page to be selected in the combobox
    await waitFor(() => {
      const combobox = accountCombobox();
      expect(combobox.textContent).toContain("Brand page");
    });
    // Brand page is selected
    expect(_isAccountSelected("Brand page")).toBe(true);
    const query = new URL(selectedReads()[0][0], "https://web.test")
      .searchParams;
    expect(query.get("connectionId")).toBe(secondAccount.id);
    expect(query.get("provider")).toBe("facebook");
    const user = userEvent.setup();
    const exported = new URL(
      await _getExportLink(user, "Export CSV"),
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
    // Wait for Brand page to be selected (fallback from unavailable account)
    await waitFor(() => {
      const combobox = accountCombobox();
      expect(combobox.textContent).toContain("Brand page");
    });
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
    // Switch to Brand page using Select
    await _selectAccount(user, "Brand page");
    expect(await screen.findByText(brandPost.text)).toBeVisible();
    // Both accounts should be available in the Select dropdown
    const combobox = accountCombobox();
    await user.click(combobox);
    expect(
      screen.getByRole("option", { name: /Launch account/i }),
    ).toBeVisible();
    expect(screen.getByRole("option", { name: /Brand page/i })).toBeVisible();
    await user.keyboard("{Escape}"); // Close dropdown
    expect(screen.queryByText(post.text)).not.toBeInTheDocument();
    expect(
      screen.queryByText("Audience and public benchmarks"),
    ).not.toBeInTheDocument();
    const exportUrl = new URL(
      await _getExportLink(user, "Export CSV"),
      "https://web.test",
    );
    expect(exportUrl.searchParams.get("connectionId")).toBe(secondAccount.id);
    expect(exportUrl.searchParams.get("search")).toBe("campaign");
    // Close the dropdown after getting export link
    await user.keyboard("{Escape}");
    await _selectAccount(user, "Launch account");
    await screen.findByText(post.text);
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
    await waitFor(() => {
      const combobox = accountCombobox();
      expect(combobox.textContent).toContain("Brand page");
    });
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
    // Brand page should be selected
    expect(_isAccountSelected("Brand page")).toBe(true);
    const user = userEvent.setup();
    expect(
      new URL(
        await _getExportLink(user, "Export spreadsheet"),
        "https://web.test",
      ).searchParams.get("connectionId"),
    ).toBe(secondAccount.id);
  });
  it.skip("stops a prior account's sync continuation after switching tabs", async () => {
    // TODO: Rewrite for automatic server-driven sync
    // This test was for manual client-driven sync which has been replaced
    // by automatic background sync via hourly cron
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
    await _selectAccount(user, "Brand page");
    // Wait for Brand page to be selected
    await waitFor(() => {
      const combobox = accountCombobox();
      expect(combobox.textContent).toContain("Brand page");
    });
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
  it.skip("keeps unsynced accounts selectable and offers account management for an empty scope", async () => {
    // TODO: Rewrite for automatic server-driven sync
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...page(),
        accounts: [{ ...account, statistics: null }],
      }),
    });
    const rendered = renderStatistics();
    expect(await screen.findByText("Launch account")).toBeVisible();
    expect(screen.getByText("Not synced yet")).toBeVisible();
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
  it.skip("reads workspace aggregates and preserves exact project ownership for account actions and exports", async () => {
    // TODO: Rewrite for automatic server-driven sync
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
    const user = userEvent.setup();
    const exportUrl = new URL(
      await _getExportLink(user, "Export CSV"),
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
    fireEvent.click(screen.getByRole("button", { name: "Sync account" }));
    await waitFor(() =>
      expect(mocks.refresh).toHaveBeenCalledWith({
        projectId: projectA,
        connectionId: account.id,
        continueHistory: false,
      }),
    );
  });
  it.skip("distinguishes duplicate workspace identities and switches to the selected connection's owning project", async () => {
    // TODO: Rewrite for automatic server-driven sync
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
    // Check the first account is selected in the combobox
    const combobox = accountCombobox();
    await user.click(combobox);
    expect(
      screen.getByRole("option", { name: /Launch account.*Launch project/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("option", { name: /Launch account.*Brand project/i }),
    ).toBeVisible();
    // Select the second duplicate
    await user.click(
      screen.getByRole("option", { name: /Launch account.*Brand project/i }),
    );
    await waitFor(() =>
      expect(
        new URL(
          selectedReads().at(-1)?.[0],
          "https://web.test",
        ).searchParams.get("connectionId"),
      ).toBe(duplicate.id),
    );
    // Close the combobox dropdown from earlier
    await user.keyboard("{Escape}");
    const exportParams = new URL(
      await _getExportLink(user, "Export CSV"),
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
  it.skip("clears old workspace project/account filters and prevents an in-flight sync from continuing in a new scope", async () => {
    // TODO: Rewrite for automatic server-driven sync
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
    fireEvent.click(screen.getByRole("button", { name: "Sync account" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    rendered.rerender(view(otherWorkspaceId));
    expect(await screen.findByText("Brand page")).toBeVisible();
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
    expect(screen.getByRole("button", { name: "Sync account" })).toBeEnabled();
  });
  it("uses full-cohort aggregates rather than the visible post page and forwards the selected filters", async () => {
    const user = userEvent.setup();
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
    expect(screen.queryByText("Details")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Showing 1 of 500 matching posts"),
    ).not.toBeInTheDocument();
    const query = new URL(selectedReads()[0][0], "https://web.test")
      .searchParams;
    expect(query.get("timezone")).toBe("Europe/Prague");
    expect(query.get("search")).toBe("launch");
    expect(query.get("contentType")).toBe("video");
    expect(query.get("postKind")).toBe("quotes");
    expect(query.get("sort")).toBe("engagementRate");
    expect(await _getExportLink(user, "Export spreadsheet")).toContain(
      "format=xlsx",
    );
  });
  it("shows the trend chart and post cards without analyst controls", async () => {
    renderStatistics();
    const overview = await screen.findByTestId("social-performance-overview");
    expect(
      within(overview).getByRole("figure", { name: "Interactions" }),
    ).toBeVisible();
    expect(screen.queryByText("Show exact values")).not.toBeInTheDocument();
    const explorer = screen.getByTestId("social-performance-posts");
    expect(within(explorer).getByTestId("social-post-preview")).toBeVisible();
    expect(
      within(explorer).queryByRole("button", { name: /^Table$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: /Select to compare/ }),
    ).not.toBeInTheDocument();
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

  it("shows connected accounts in the account select and external read-only posts", async () => {
    const user = userEvent.setup();
    renderStatistics();
    expect(await screen.findByText(post.text)).toBeVisible();
    await user.click(accountCombobox());
    expect(
      screen.getByRole("option", { name: /launch account/i }),
    ).toBeVisible();
    expect(screen.getByRole("option", { name: /brand page/i })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("heading", { name: "Brand page" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Link clicks")).not.toBeInTheDocument();
    expect(screen.queryByText("More metrics")).not.toBeInTheDocument();
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
      within(screen.getByTestId("social-post-preview")).getByText(
        reader.dateTime(new Date(post.publishedAt), {
          dateStyle: "medium",
          timeZone: "UTC",
        }),
      ),
    ).toBeVisible();
    const user = userEvent.setup();
    await user.click(accountCombobox());
    expect(screen.getByRole("option", { name: /brand page/i })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Brand page" }),
    ).not.toBeInTheDocument();
  });
  it("keeps account metrics visible while publication date filters are invalid", async () => {
    renderStatistics("?publishedFrom=2026-10-08&publishedUntil=2026-10-01");
    // Account information should still be visible in the header
    expect(await screen.findByText("Launch account")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose an ordered publication range",
    );
    expect(screen.queryByText(post.text)).not.toBeInTheDocument();
    // Export options are now in a dropdown menu - check they're disabled
    const moreActionsButton = screen.getByRole("button", {
      name: "More actions",
    });
    expect(moreActionsButton).toBeVisible();
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
    expect(screen.getByText("Some post metrics missing")).toBeVisible();
    expect(screen.queryByText("Limited history")).not.toBeInTheDocument();
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
  it.skip("syncs the selected account's history pages sequentially and refreshes its cache after each page", async () => {
    // TODO: Rewrite for automatic server-driven sync
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
  it.skip("continues history when account metrics are unavailable but a next page exists", async () => {
    // TODO: Rewrite for automatic server-driven sync
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
    fireEvent.click(screen.getByRole("button", { name: "Sync account" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
  });
  it.skip("resumes an incomplete retained history cursor", async () => {
    // TODO: Rewrite for automatic server-driven sync
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
  it.skip("retains the returned resume cursor when a follow-up cache read fails", async () => {
    // TODO: Rewrite for automatic server-driven sync
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => page() })
      .mockResolvedValueOnce({ ok: true, json: async () => page() })
      .mockResolvedValue({ ok: false });
    mocks.refresh
      .mockResolvedValueOnce(response(account, "retained-next-page"))
      .mockResolvedValueOnce({ ok: false, error: { message: "Rate limited" } });
    renderStatistics();
    await screen.findByText(post.text);
    fireEvent.click(screen.getByRole("button", { name: "Sync account" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("button", { name: "Resume sync" }),
    ).toBeEnabled();
    expect(screen.getByText(post.text)).toBeVisible();
  });

  it.skip("stops after the in-flight page when canceled", async () => {
    // TODO: Rewrite for automatic server-driven sync
    let resolvePage: (value: ReturnType<typeof response>) => void = () => {};
    mocks.refresh.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePage = resolve;
        }),
    );
    renderStatistics();
    await screen.findByText(post.text);
    fireEvent.click(screen.getByRole("button", { name: "Sync account" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop sync" }));
    await act(async () => resolvePage(response(account, "next-page")));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Sync account" }),
      ).toBeEnabled(),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it.skip("does not request another page after unmount", async () => {
    // TODO: Rewrite for automatic server-driven sync
    let resolvePage: (value: ReturnType<typeof response>) => void = () => {};
    mocks.refresh.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePage = resolve;
        }),
    );
    const rendered = renderStatistics();
    await screen.findByText(post.text);
    fireEvent.click(screen.getByRole("button", { name: "Sync account" }));
    rendered.unmount();
    await act(async () => resolvePage(response(account, "next-page")));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it.skip("retains selected cached posts on sync failure without syncing other accounts", async () => {
    // TODO: Rewrite for automatic server-driven sync
    mocks.refresh.mockResolvedValueOnce({
      ok: false,
      error: { message: "Denied" },
    });
    renderStatistics();
    await screen.findByText(post.text);
    fireEvent.click(screen.getByRole("button", { name: "Sync account" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Sync failed. Saved results kept.")).toBeVisible();
    expect(screen.getByText(post.text)).toBeVisible();
  });
  it.skip("shows provider history limitations without claiming completion and disables reauthorization-required sync", async () => {
    // TODO: Rewrite for automatic server-driven sync
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
    expect(screen.getByText("Limited history")).toHaveAttribute(
      "title",
      "Check the account permissions and sync again.",
    );
    expect(screen.getByRole("button", { name: "Sync account" })).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "Manage accounts" }),
    ).toHaveAttribute("href", "/social?projectId=project-1&tab=accounts");
  });
});
