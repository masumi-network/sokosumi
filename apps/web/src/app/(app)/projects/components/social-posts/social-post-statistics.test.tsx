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

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  recycle: vi.fn(),
  fetch: vi.fn(),
}));
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
  recycleProjectSocialAccountPost: mocks.recycle,
}));
vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  const { createFormatter, createTranslator } =
    await vi.importActual<typeof import("next-intl")>("next-intl");
  return {
    useLocale: () => "en",
    useFormatter: () => ({
      ...createTestFormatter({ timeZone: "America/Los_Angeles" }),
      relativeTime: createFormatter({
        locale: "en",
        now: new Date("2026-10-14T08:00:00Z"),
      }).relativeTime,
    }),
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
  avatarUrl: null,
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
const post = {
  id: "post-1",
  connectionId: account.id,
  provider: "x",
  externalId: "outside-123",
  publishedAt: "2026-10-01T00:15:00Z",
  text: "Published outside Sokosumi",
  contentType: "text",
  postKind: "post",
  media: [],
  url: "https://x.com/launch/status/123",
  metrics: {
    views: 0,
    impressions: null,
    likes: 5,
    comments: null,
    shares: 1,
    saves: null,
  },
  additionalMetrics: [
    { key: "url_clicks", value: 9, period: "lifetime", unit: null },
  ],
  fetchedAt: "2026-10-08T08:00:00Z",
};
const headline = {
  current: {
    postCount: 1,
    views: 0,
    impressions: null,
    interactions: 6,
  },
  previous: {
    postCount: 0,
    views: null,
    impressions: null,
    interactions: null,
  },
  deltas: {
    postCount: 1,
    views: null,
    impressions: null,
    interactions: null,
  },
  daily: [
    {
      date: "2026-10-01",
      postCount: 1,
      views: 0,
      impressions: null,
      interactions: 6,
    },
  ],
};
function page(cursor: string | null = null) {
  return {
    accounts: [account, secondAccount],
    posts: [post],
    nextCursor: cursor,
    headline,
    consistency: {
      from: "2026-10-08",
      until: "2026-10-08",
      daily: [{ date: "2026-10-08", postCount: 1, interactions: 4 }],
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
function renderStatistics(
  searchParams = "",
  scope: { projectId: string } | { workspaceId: string } = {
    projectId: "project-1",
  },
) {
  return render(
    <TestQueryProvider>
      <NuqsTestingAdapter searchParams={searchParams}>
        <SocialPostStatistics {...scope} />
      </NuqsTestingAdapter>
    </TestQueryProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.refresh.mockReset();
  mocks.recycle.mockReset();
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => page() });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SocialPostStatistics account history", () => {
  it("renders imported media inside the published preview beside measured metrics", async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...page(),
        posts: [
          {
            ...post,
            contentType: "image",
            media: [
              {
                kind: "image",
                url: "https://pbs.twimg.com/media/one.jpg",
                thumbnailUrl: null,
              },
            ],
          },
        ],
      }),
    });
    renderStatistics();
    const preview = await screen.findByTestId("social-post-preview");
    const card = screen.getByRole("listitem");
    expect(card).toContainElement(preview);
    expect(preview).toHaveAttribute("data-compact", "true");
    expect(within(preview).getByRole("img", { name: "image" })).toHaveAttribute(
      "src",
      "https://pbs.twimg.com/media/one.jpg",
    );
    expect(within(card).getByText("Views").closest("div")).toHaveTextContent(
      "0",
    );
    expect(within(card).queryByText("Impressions")).not.toBeInTheDocument();
    expect(within(card).getByText("Link clicks").closest("dl")).toBe(
      within(card).getByText("Views").closest("dl"),
    );
  });

  it("shows placeholder cards while statistics load", () => {
    mocks.fetch.mockImplementation(() => new Promise(() => {}));
    renderStatistics();
    const loading = screen.getByTestId("social-statistics-loading");
    expect(loading).toBeVisible();
    expect(loading).toHaveTextContent(
      en.App.Projects.SocialPosts.statistics.loading,
    );
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(loading).toHaveAttribute("role", "status");
    expect(
      within(loading).getAllByTestId("social-published-post-skeleton"),
    ).toHaveLength(2);
    expect(screen.queryByText(post.text)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Last \d+ days/ }),
    ).not.toBeInTheDocument();
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

  it("shows a quiet Updating line while a background sync is queued", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...page(),
        accounts: [
          {
            ...account,
            sync: { status: "queued", mayAutoRequest: false },
          },
          secondAccount,
        ],
      }),
    });
    renderStatistics();
    expect(await screen.findByText("Updating…")).toBeVisible();
    expect(screen.getByText(post.text)).toBeVisible();
    expect(
      screen.queryByText(/Launch account.*queued/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Sync now|Refresh Launch/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the reconnect hint and a relative Updated line when data is fresh", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...page(),
        accounts: [
          {
            ...account,
            status: "reauthorization_required",
            sync: { status: "reauth_required", mayAutoRequest: false },
          },
        ],
      }),
    });
    renderStatistics();
    expect(await screen.findByText(post.text)).toBeVisible();
    const header = screen
      .getByRole("combobox", { name: "Connected accounts" })
      .closest("section");
    expect(header).toBeTruthy();
    expect(within(header as HTMLElement).getByText(/^Updated /)).toBeVisible();
    expect(
      screen.getByText(/Reconnect this account before syncing statistics/),
    ).toBeVisible();
    expect(screen.queryByText("Updating…")).not.toBeInTheDocument();
  });

  it("shows headline metrics and imported posts without the old account-card grid", async () => {
    renderStatistics();
    expect(await screen.findByText(post.text)).toBeVisible();
    expect(screen.getByRole("button", { name: /Sync/ })).toHaveClass(
      "h-11",
      "md:h-8",
    );
    for (const days of [7, 30, 90]) {
      expect(
        screen.getByRole("button", { name: `Last ${days} days` }),
      ).toHaveClass("h-11", "md:h-8");
    }
    expect(
      screen.getByRole("heading", { name: "Posting consistency" }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Account performance" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Account performance" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("More filters")).toBeVisible();
    expect(screen.getByTestId("social-performance-overview")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Performance over time" }),
    ).toBeVisible();
    expect(screen.getByText("Posts")).toBeVisible();
    expect(screen.getAllByText("Interactions")[0]).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Connected accounts" }),
    ).toHaveClass(
      "h-11",
      "md:h-10",
      "data-[size=default]:h-11",
      "md:data-[size=default]:h-10",
    );
    expect(screen.getByRole("button", { name: "More actions" })).toBeVisible();
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
  it("offers CSV and spreadsheet downloads for the selected filters", async () => {
    renderStatistics();
    expect(await screen.findByText(post.text)).toBeVisible();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "More actions" }));
    expect(
      await screen.findByRole("menuitem", { name: "Export CSV" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(
        "/api/projects/project-1/social-statistics/export?",
      ),
    );
    expect(
      screen.getByRole("menuitem", { name: "Export spreadsheet" }),
    ).toHaveAttribute("href", expect.stringContaining("format=xlsx"));
  });
  it("dates All accounts from the latest fetched snapshot", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...page(),
        accounts: [
          {
            ...account,
            statistics: { ...snapshot, fetchedAt: "2026-10-01T08:00:00Z" },
          },
          {
            ...secondAccount,
            statistics: { ...snapshot, fetchedAt: "2026-10-08T08:00:00Z" },
          },
        ],
      }),
    });
    renderStatistics();
    expect(await screen.findByText(post.text)).toBeVisible();
    expect(screen.getAllByText("Updated 6 days ago")).toHaveLength(2);
    expect(screen.queryByText("Updated 13 days ago")).not.toBeInTheDocument();
  });
  it("keeps Impressions on All accounts when an X account is connected", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...page(),
        accounts: [account],
        headline: {
          ...headline,
          current: {
            ...headline.current,
            views: null,
            impressions: 400,
          },
          deltas: { ...headline.deltas, views: null, impressions: -20 },
          daily: [
            {
              date: "2026-10-01",
              postCount: 1,
              views: null,
              impressions: 400,
              interactions: 6,
            },
          ],
        },
      }),
    });
    renderStatistics();
    expect(await screen.findByText(post.text)).toBeVisible();
    const overview = screen.getByTestId("social-performance-overview");
    expect(within(overview).getByText("Impressions")).toBeVisible();
    expect(within(overview).queryByText("Views")).not.toBeInTheDocument();
  });
  it("renders the real platform preview and author on each published post card", async () => {
    renderStatistics();
    expect(await screen.findByText(post.text)).toBeVisible();
    const card = screen.getByRole("listitem");
    const preview = within(card).getByTestId("social-post-preview");
    expect(preview).toHaveAttribute("data-provider", "x");
    expect(preview).toHaveTextContent("Launch account");
    expect(preview).toHaveTextContent("@launch");
    expect(within(card).getByText("Link clicks")).toBeVisible();
    expect(card.querySelectorAll("dl")).toHaveLength(1);
    expect(within(card).getByText("Link clicks").closest("dl")).toBe(
      within(card).getByText("Likes / reactions").closest("dl"),
    );
    expect(within(card).queryByText("Lifetime")).not.toBeInTheDocument();
  });
  it("hides the trend chart when the selected period has no daily points", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...page(),
        headline: { ...headline, daily: [] },
      }),
    });
    renderStatistics();
    expect(await screen.findByText(post.text)).toBeVisible();
    expect(screen.getByTestId("social-performance-overview")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Performance over time" }),
    ).not.toBeInTheDocument();
  });
  it("uses the shared empty state when no imported posts match", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...page(), posts: [] }),
    });
    renderStatistics();
    expect(
      await screen.findByText(en.App.Projects.SocialPosts.statistics.empty),
    ).toBeVisible();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
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
        }),
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Connected accounts" }),
    ).toBeVisible();
  });
  it("keeps the header visible while publication date filters are invalid", async () => {
    renderStatistics("?publishedFrom=2026-10-08&publishedUntil=2026-10-01");
    expect(
      await screen.findByRole("combobox", { name: "Connected accounts" }),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "End date must be on or after",
    );
    expect(screen.queryByText(post.text)).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("social-performance-overview"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Posting consistency" }),
    ).not.toBeInTheDocument();
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
    const card = screen.getByRole("listitem");
    expect(within(card).getByTestId("social-post-preview")).toBeVisible();
    expect(
      within(card).getByText("Likes / reactions").closest("div"),
    ).toHaveTextContent("5");
    expect(
      screen.queryByText(
        "All history currently available from the platform has been imported.",
      ),
    ).not.toBeInTheDocument();
  });

  it("loads every cached post page", async () => {
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => page("next-post") })
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
      ).searchParams.get("cursor"),
    ).toBe("next-post");
  });
  it("shows an inline error when loading more posts fails", async () => {
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => page("next-post") })
      .mockResolvedValueOnce({ ok: false })
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
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load more.",
    );
    expect(
      screen.queryByText("Failed to load statistics"),
    ).not.toBeInTheDocument();
    expect(screen.getByText(post.text)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Load more posts" }));
    expect(await screen.findByText("Second external post")).toBeVisible();
    expect(screen.queryByText("Couldn't load more.")).not.toBeInTheDocument();
  });
  it("asks for a background refresh when Performance opens with stale accounts", async () => {
    mocks.refresh.mockResolvedValue(response(account));
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...page(),
        accounts: [
          {
            ...account,
            sync: { mayAutoRequest: true, status: "stale" },
          },
          {
            ...secondAccount,
            sync: { mayAutoRequest: false, status: "fresh" },
          },
        ],
      }),
    });
    renderStatistics();
    expect(await screen.findByText(post.text)).toBeVisible();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).toHaveBeenCalledWith({
      projectId: "project-1",
      connectionId: account.id,
    });
    expect(
      screen.getByRole("button", { name: "Sync all accounts" }),
    ).toBeEnabled();
    expect(screen.getByText(post.text)).toBeVisible();
  });

  it("does not auto-request a refresh when every account is already fresh", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...page(),
        accounts: [
          {
            ...account,
            sync: { mayAutoRequest: false, status: "fresh" },
          },
        ],
      }),
    });
    renderStatistics();
    expect(await screen.findByText(post.text)).toBeVisible();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("enqueues one refresh per account and never walks history in the browser", async () => {
    mocks.refresh
      .mockResolvedValueOnce(response(account, "provider-page-2"))
      .mockResolvedValueOnce(response(secondAccount));
    renderStatistics();
    await screen.findByText(post.text);
    fireEvent.click(screen.getByRole("button", { name: "Sync all accounts" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
    expect(mocks.refresh.mock.calls.map(([params]) => params)).toEqual([
      {
        projectId: "project-1",
        connectionId: account.id,
      },
      {
        projectId: "project-1",
        connectionId: secondAccount.id,
      },
    ]);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Sync all accounts" }),
      ).toBeEnabled(),
    );
  });
  it("enqueues a single refresh for an incomplete retained history cursor", async () => {
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
      }),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it("does not enqueue again after unmount", async () => {
    let resolvePage: (value: ReturnType<typeof response>) => void = () => {};
    mocks.refresh.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePage = resolve;
        }),
    );
    const rendered = renderStatistics();
    await screen.findByText(post.text);
    fireEvent.click(screen.getByRole("button", { name: "Sync all accounts" }));
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
    expect(screen.getByText(/Cached results are retained/)).toBeVisible();
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
      screen.getByText(
        "History is incomplete or limited by the platform. Check the account permissions and try syncing again.",
      ),
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

  it("shows no provider icon in the trigger for All accounts", async () => {
    renderStatistics();
    const trigger = await screen.findByRole("combobox", {
      name: "Connected accounts",
    });
    expect(trigger).toHaveTextContent("All accounts");
    expect(
      trigger.querySelectorAll("[data-testid='social-post-provider-icon']"),
    ).toHaveLength(0);
  });

  it.each([
    "x",
    "linkedin",
    "facebook",
    "instagram",
    "tiktok",
    "youtube",
  ] as const)(
    "shows exactly one %s icon in the trigger when that account is selected",
    async (provider) => {
      mocks.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          ...page(),
          accounts: [
            {
              ...account,
              provider,
              displayName: `${provider} account`,
            },
          ],
        }),
      });
      renderStatistics(`?statisticsAccount=${account.id}`);
      const trigger = await screen.findByRole("combobox", {
        name: "Connected accounts",
      });
      expect(trigger).toHaveTextContent(`${provider} account`);
      expect(
        trigger.querySelectorAll("[data-testid='social-post-provider-icon']"),
      ).toHaveLength(1);
    },
  );

  it("keeps provider icons on account options and none on All accounts", async () => {
    renderStatistics();
    fireEvent.click(
      await screen.findByRole("combobox", { name: "Connected accounts" }),
    );
    expect(
      (
        await screen.findByRole("option", { name: "All accounts" })
      ).querySelectorAll("[data-testid='social-post-provider-icon']"),
    ).toHaveLength(0);
    expect(
      screen
        .getByRole("option", { name: "Launch account" })
        .querySelectorAll("[data-testid='social-post-provider-icon']"),
    ).toHaveLength(1);
    expect(
      screen
        .getByRole("option", { name: "Brand page" })
        .querySelectorAll("[data-testid='social-post-provider-icon']"),
    ).toHaveLength(1);
  });

  it("shows Recycle only for a strong post the account can reshare", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...page(),
        posts: [
          { ...post, strong: true, canRecycle: true },
          {
            ...post,
            id: "post-weak",
            text: "Quiet post",
            strong: false,
            canRecycle: true,
          },
          {
            ...post,
            id: "post-locked",
            text: "Strong but disconnected",
            strong: true,
            canRecycle: false,
          },
        ],
      }),
    });
    renderStatistics();
    expect(await screen.findByText(post.text)).toBeVisible();
    expect(screen.getAllByText("Strong")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Recycle" })).toBeVisible();
    expect(screen.getByText("Quiet post")).toBeVisible();
    expect(screen.getByText("Strong but disconnected")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Recycle" })).toHaveLength(1);
    const card = screen.getByText(post.text).closest("li");
    expect(card).not.toBeNull();
    if (!card) throw new Error("Published post card is missing");
    expect(within(card).getByTestId("social-post-preview")).toHaveAttribute(
      "data-provider",
      "x",
    );
    const badge = within(card).getByText("Strong");
    expect(badge.parentElement).toContainElement(
      within(card).getByText("Oct 1, 12:15 AM"),
    );
    const recycle = within(card).getByRole("button", { name: "Recycle" });
    expect(recycle.parentElement).toContainElement(
      within(card).getByRole("link", {
        name: en.App.Projects.SocialPosts.statistics.openPost,
      }),
    );
  });

  it("saves a recycled post as a draft", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...page(),
        posts: [{ ...post, strong: true, canRecycle: true }],
      }),
    });
    mocks.recycle.mockResolvedValue({
      ok: true,
      value: { id: "draft-1", status: "DRAFT" },
    });
    renderStatistics();
    fireEvent.click(await screen.findByRole("button", { name: "Recycle" }));
    expect(
      await screen.findByRole("heading", { name: "Recycle this post?" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    await waitFor(() =>
      expect(mocks.recycle).toHaveBeenCalledWith({
        projectId: "project-1",
        accountPostId: post.id,
      }),
    );
  });

  it("schedules a recycled post in seven days", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...page(),
        posts: [{ ...post, strong: true, canRecycle: true }],
      }),
    });
    mocks.recycle.mockResolvedValue({
      ok: true,
      value: { id: "scheduled-1", status: "SCHEDULED" },
    });
    renderStatistics();
    fireEvent.click(await screen.findByRole("button", { name: "Recycle" }));
    fireEvent.click(await screen.findByRole("button", { name: "In 7 days" }));
    await waitFor(() =>
      expect(mocks.recycle).toHaveBeenCalledWith({
        projectId: "project-1",
        accountPostId: post.id,
        delayDays: 7,
        timezone: expect.any(String),
      }),
    );
  });

  it("hides Recycle when a post is not marked strong", async () => {
    renderStatistics();
    expect(await screen.findByText(post.text)).toBeVisible();
    expect(screen.queryByText("Strong")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Recycle" }),
    ).not.toBeInTheDocument();
  });

  it("hides project-only Recycle on the all-projects view", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...page(),
        posts: [{ ...post, strong: true, canRecycle: true }],
      }),
    });
    renderStatistics("", { workspaceId: "workspace-1" });
    expect(await screen.findByText(post.text)).toBeVisible();
    expect(screen.getByText("Strong")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Recycle" }),
    ).not.toBeInTheDocument();
  });

  it("reads workspace statistics and hides Sync on the all-projects view", async () => {
    renderStatistics("", { workspaceId: "workspace-1" });
    expect(await screen.findByText(post.text)).toBeVisible();
    const url = new URL(mocks.fetch.mock.calls[0][0], "https://web.test");
    expect(url.pathname).toBe("/api/workspaces/workspace-1/social-statistics");
    expect(
      screen.queryByRole("button", { name: /sync/i }),
    ).not.toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "More actions" }));
    expect(
      await screen.findByRole("menuitem", { name: "Export CSV" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(
        "/api/workspaces/workspace-1/social-statistics/export?",
      ),
    );
  });

  it("keeps one Updated line per card and one in the header beside Sync", async () => {
    renderStatistics();
    await screen.findByText(post.text);
    expect(screen.getAllByText("Updated 6 days ago")).toHaveLength(2);
    const card = screen.getByRole("listitem");
    expect(within(card).getAllByText(/^Updated /)).toHaveLength(1);
    expect(within(card).getByText(/^Updated /)).toHaveClass(
      "text-muted-foreground",
      "text-xs",
    );
    expect(
      screen.getByRole("button", { name: "Sync all accounts" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Sync now" }),
    ).not.toBeInTheDocument();
  });

  it("polls while a sync is queued and stops when it is fresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.fetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        ...page(),
        accounts: [{ ...account, sync: { status: "queued" } }],
      }),
    }));
    renderStatistics();
    await screen.findByText(post.text);
    const afterFirst = mocks.fetch.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mocks.fetch.mock.calls.length).toBeGreaterThan(afterFirst);
    mocks.fetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        ...page(),
        accounts: [{ ...account, sync: { status: "fresh" } }],
      }),
    }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    const afterFresh = mocks.fetch.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mocks.fetch.mock.calls.length).toBe(afterFresh);
  });

  it("refetches when the tab is focused", async () => {
    renderStatistics();
    await screen.findByText(post.text);
    const afterLoad = mocks.fetch.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(mocks.fetch.mock.calls.length).toBeGreaterThan(afterLoad),
    );
  });
});
