import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSocialAccountStatisticsPage } from "@/clients/social-post-providers/account-statistics";
import {
  fetchSocialPostStatistics,
  SocialPostStatisticsUnavailableError,
} from "@/clients/social-post-providers/statistics";
import { zernioRequest } from "@/clients/zernio.client";

vi.mock("@/clients/zernio.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/zernio.client")>()),
  zernioRequest: vi.fn(),
}));

const connection = {
  provider: "tiktok" as const,
  connectedAccountId: "zernio:alpha",
  executorUserId: "executor",
  externalAccountId: "user",
  externalHandle: "name",
};
const platform = {
  platform: "tiktok",
  accountId: "alpha",
  status: "published",
  syncStatus: "synced",
  analytics: { views: 7, likes: 1, comments: 0, shares: 2, saves: 0 },
};
const expectedMetrics = {
  views: 7,
  likes: 1,
  comments: 0,
  shares: 2,
  saves: null,
  impressions: null,
};

describe("Zernio TikTok statistics", () => {
  beforeEach(() => {
    vi.mocked(zernioRequest).mockReset();
  });

  it("reads a published post's synced counters for its exact connected account", async () => {
    vi.mocked(zernioRequest).mockResolvedValueOnce({
      platformAnalytics: [
        { ...platform, accountId: "other", analytics: { views: 99 } },
        platform,
      ],
    });
    await expect(
      fetchSocialPostStatistics({ ...connection, externalId: "zpost" }),
    ).resolves.toEqual(expectedMetrics);
    expect(zernioRequest).toHaveBeenCalledWith(
      "/analytics?platform=tiktok&accountId=alpha&postId=zpost",
      { signal: undefined },
    );
  });

  it("reports pending metrics as unavailable", async () => {
    vi.mocked(zernioRequest).mockResolvedValueOnce({
      platformAnalytics: [{ ...platform, syncStatus: "pending" }],
    });
    await expect(
      fetchSocialPostStatistics({ ...connection, externalId: "zpost" }),
    ).rejects.toBeInstanceOf(SocialPostStatisticsUnavailableError);
  });

  it("maps follower totals and a history page with the original Zernio post id", async () => {
    vi.mocked(zernioRequest)
      .mockResolvedValueOnce({
        accounts: [{ _id: "alpha", platform: "tiktok", currentFollowers: 12 }],
      })
      .mockResolvedValueOnce({
        pagination: { page: 1, total: 51, limit: 50 },
        posts: [
          {
            _id: "external",
            latePostId: "zpost",
            content: "Hello",
            publishedAt: "2026-11-18T11:00:00Z",
            mediaType: "video",
            platforms: [platform],
          },
          {
            _id: "otherpost",
            platforms: [{ ...platform, accountId: "other" }],
          },
        ],
      });
    const page = await fetchSocialAccountStatisticsPage({
      ...connection,
      cursor: null,
      includeProfile: true,
    });
    expect(page.accountMetrics).toContainEqual({
      key: "follower_count",
      value: 12,
      period: "lifetime",
      unit: "count",
    });
    expect(page.posts).toMatchObject([
      {
        externalId: "zpost",
        text: "Hello",
        contentType: "video",
        metrics: expectedMetrics,
      },
    ]);
    expect(page.nextCursor).toBe("2");
  });

  it("surfaces inaccessible analytics independently of the publishing connection", async () => {
    vi.mocked(zernioRequest).mockRejectedValue(new Error("analytics disabled"));
    const page = await fetchSocialAccountStatisticsPage({
      ...connection,
      cursor: null,
      includeProfile: true,
    });
    expect(page.accountError).toMatch(/unavailable through Zernio/);
    expect(page.historyError).toMatch(/unavailable through Zernio/);
    expect(page.posts).toEqual([]);
  });
});
