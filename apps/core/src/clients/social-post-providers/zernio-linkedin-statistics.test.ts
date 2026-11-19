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

const page = {
  provider: "linkedin" as const,
  connectedAccountId: "zernio:alpha",
  executorUserId: "executor",
  externalAccountId: "urn:li:organization:42",
  externalHandle: "acme",
};
const platform = {
  platform: "linkedin",
  accountId: "alpha",
  status: "published",
  syncStatus: "synced",
  analytics: { impressions: 120, views: 0, likes: 4, comments: 1, shares: 2 },
};
const expectedMetrics = {
  views: null,
  impressions: 120,
  likes: 4,
  comments: 1,
  shares: 2,
  saves: null,
};

describe("Zernio LinkedIn statistics", () => {
  beforeEach(() => {
    vi.mocked(zernioRequest).mockReset();
  });

  it("reads a Page post's impressions, not views, for its exact account", async () => {
    vi.mocked(zernioRequest).mockResolvedValueOnce({
      platformAnalytics: [
        { ...platform, accountId: "other", analytics: { impressions: 999 } },
        platform,
      ],
    });
    await expect(
      fetchSocialPostStatistics({ ...page, externalId: "zpost" }),
    ).resolves.toEqual(expectedMetrics);
    expect(zernioRequest).toHaveBeenCalledWith(
      "/analytics?platform=linkedin&accountId=alpha&postId=zpost",
      { signal: undefined },
    );
  });

  it("still has no numbers for a profile connected through Composio", async () => {
    await expect(
      fetchSocialPostStatistics({
        ...page,
        connectedAccountId: "ca_linkedin",
        externalAccountId: "9Acyt0wAkf",
        externalId: "urn:li:share:1",
      }),
    ).rejects.toBeInstanceOf(SocialPostStatisticsUnavailableError);
    expect(zernioRequest).not.toHaveBeenCalled();
  });

  it("reads the Page's followers and its post history", async () => {
    vi.mocked(zernioRequest)
      .mockResolvedValueOnce({
        accounts: [
          { _id: "alpha", platform: "linkedin", currentFollowers: 830 },
        ],
      })
      .mockResolvedValueOnce({
        pagination: { page: 1, total: 1, limit: 50 },
        posts: [
          {
            _id: "external",
            latePostId: "zpost",
            content: "We shipped",
            publishedAt: "2026-11-18T11:00:00Z",
            mediaType: "image",
            platforms: [platform],
          },
        ],
      });
    const result = await fetchSocialAccountStatisticsPage({
      ...page,
      cursor: null,
      includeProfile: true,
    });
    // A Page has followers; TikTok's following, likes and video counts are not asked for.
    expect(result.accountMetrics).toEqual([
      {
        key: "follower_count",
        value: 830,
        period: "lifetime",
        unit: "count",
      },
    ]);
    expect(result.posts).toMatchObject([
      { externalId: "zpost", text: "We shipped", metrics: expectedMetrics },
    ]);
    expect(result.nextCursor).toBeNull();
    expect(zernioRequest).toHaveBeenLastCalledWith(
      "/analytics?platform=linkedin&accountId=alpha&page=1&limit=50",
      { signal: undefined },
    );
  });
});
