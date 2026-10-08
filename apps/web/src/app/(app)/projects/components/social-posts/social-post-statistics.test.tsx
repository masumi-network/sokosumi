import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  refreshProjectSocialPostStatistics: mocks.refresh,
}));
vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  const { createTranslator } =
    await vi.importActual<typeof import("next-intl")>("next-intl");
  return {
    useFormatter: () =>
      createTestFormatter({ timeZone: "America/Los_Angeles" }),
    useTranslations: () =>
      createTranslator({
        locale: "en",
        messages: en.App.Projects.SocialPosts.statistics,
      }),
  };
});
const statistics = {
  metrics: {
    views: 0,
    impressions: null,
    likes: 5,
    comments: null,
    shares: 1,
    saves: null,
  },
  fetchedAt: "2026-10-08T08:00:00Z",
  refreshAttemptedAt: "2026-10-08T08:00:00Z",
  error: null,
};
const post = {
  id: "post-1",
  provider: "x",
  publishedAt: "2026-10-01T10:00:00Z",
  text: "Launch post",
  statistics,
};
function page(cursor: string | null = null) {
  return {
    posts: [post],
    summary: [
      {
        provider: "x",
        postCount: 22,
        measuredPostCount: 1,
        metrics: statistics.metrics,
      },
    ],
    nextCursor: cursor,
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
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => page() });
});
afterEach(() => vi.unstubAllGlobals());

describe("SocialPostStatistics", () => {
  it("keeps zero distinct from unavailable and shows full filtered summary coverage", async () => {
    renderStatistics();
    expect(await screen.findByText("Launch post")).toBeVisible();
    expect(screen.getByText("1 of 22 posts have statistics")).toBeVisible();
    expect(screen.getAllByText("0")).toHaveLength(2);
    expect(screen.getAllByText("Unavailable")).toHaveLength(6);
    expect(screen.getByText(/^Updated/)).toBeVisible();
  });
  it("filters by publication date and platform in the request", async () => {
    renderStatistics(
      "?statisticsProvider=x&publishedFrom=2026-10-01&publishedUntil=2026-10-08",
    );
    await screen.findByText("Launch post");
    const url = new URL(mocks.fetch.mock.calls[0][0], "https://web.test");
    expect(url.searchParams.get("provider")).toBe("x");
    expect(url.searchParams.get("publishedFrom")).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(url.searchParams.get("publishedUntil")).toBe(
      "2026-10-08T23:59:59.999Z",
    );
  });
  it("uses the same UTC date for filtering and publication display across reader timezones", async () => {
    const publishedAt = "2026-10-01T00:15:00Z";
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...page(), posts: [{ ...post, publishedAt }] }),
    });
    renderStatistics("?publishedFrom=2026-10-01&publishedUntil=2026-10-01");
    await screen.findByText("Launch post");
    const url = new URL(mocks.fetch.mock.calls[0][0], "https://web.test");
    expect(url.searchParams.get("publishedFrom")).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(url.searchParams.get("publishedUntil")).toBe(
      "2026-10-01T23:59:59.999Z",
    );
    const { createTestFormatter } = await import("@/test/intl-formatter");
    const readerFormatter = createTestFormatter({
      timeZone: "America/Los_Angeles",
    });
    expect(
      screen.getByText(
        readerFormatter.dateTime(new Date(publishedAt), "dateTime", {
          timeZone: "UTC",
          timeZoneName: "short",
        }),
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(
        readerFormatter.dateTime(new Date(publishedAt), "dateTime"),
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Published from (UTC)")).toBeVisible();
    expect(screen.getByLabelText("Published until (UTC)")).toBeVisible();
  });

  it("loads additional posts rather than silently capping the report", async () => {
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => page("next-post") })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          posts: [{ ...post, id: "post-2", text: "Second post" }],
          summary: page().summary,
          nextCursor: null,
        }),
      });
    renderStatistics();
    fireEvent.click(
      await screen.findByRole("button", { name: "Load more posts" }),
    );
    expect(await screen.findByText("Second post")).toBeVisible();
    expect(
      new URL(
        mocks.fetch.mock.calls[1][0],
        "https://web.test",
      ).searchParams.get("cursor"),
    ).toBe("next-post");
  });
  it("retains cached metrics when refresh fails and offers another attempt", async () => {
    mocks.refresh.mockResolvedValue({
      ok: false,
      error: { message: "Denied" },
    });
    renderStatistics();
    await screen.findByText("Launch post");
    fireEvent.click(screen.getByRole("button", { name: "Refresh statistics" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Previous results are retained",
    );
    expect(screen.getAllByText("0")).toHaveLength(2);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh statistics" }),
      ).toBeEnabled(),
    );
    expect(mocks.refresh).toHaveBeenCalledWith({
      projectId: "project-1",
      postId: "post-1",
    });
  });
  it("reloads persisted statistics after a refresh", async () => {
    mocks.refresh.mockResolvedValue({ ok: true, value: post });
    renderStatistics();
    await screen.findByText("Launch post");
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...page(),
        posts: [
          {
            ...post,
            statistics: {
              ...statistics,
              metrics: { ...statistics.metrics, views: 10 },
            },
          },
        ],
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh statistics" }));
    expect(await screen.findByText("10")).toBeVisible();
  });
});
