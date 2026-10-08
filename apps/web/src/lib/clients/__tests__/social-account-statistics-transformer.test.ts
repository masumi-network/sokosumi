import {
  getProjectsByIdSocialConnectionsStatisticsResponseTransformer,
  postProjectsByIdSocialConnectionsByConnectionIdStatisticsRefreshResponseTransformer,
} from "@sokosumi/core-client/transformers";
import { describe, expect, it } from "vitest";

const timestamp = "2026-10-08T10:00:00.000Z";

function buildAccount(statistics: unknown) {
  return {
    id: "connection-1",
    projectId: "project-1",
    provider: "x",
    createdAt: timestamp,
    updatedAt: timestamp,
    statistics,
    postCount: 0,
  };
}

describe("social account statistics response transformers", () => {
  it.each([null, undefined])(
    "accepts accounts without a statistics snapshot (%s)",
    async (statistics) => {
      const account = buildAccount(statistics);
      const result =
        await getProjectsByIdSocialConnectionsStatisticsResponseTransformer({
          data: { accounts: [account], posts: [], nextCursor: null },
          meta: { timestamp, requestId: "request-1" },
        });

      expect(result.data.accounts[0].statistics).toBe(statistics);
      expect(result.data.posts).toEqual([]);
    },
  );

  it("converts cached snapshot dates in list and refresh responses", async () => {
    const statistics = {
      metrics: [],
      fetchedAt: timestamp,
      refreshAttemptedAt: timestamp,
      historyFetchedAt: timestamp,
      error: null,
      historyNextCursor: null,
      historyComplete: true,
      historyError: null,
      metricWarning: null,
    };
    const list =
      await getProjectsByIdSocialConnectionsStatisticsResponseTransformer({
        data: {
          accounts: [buildAccount({ ...statistics })],
          posts: [],
          nextCursor: null,
        },
        meta: { timestamp, requestId: "request-1" },
      });
    const refresh =
      await postProjectsByIdSocialConnectionsByConnectionIdStatisticsRefreshResponseTransformer(
        {
          data: {
            account: buildAccount({ ...statistics }),
            importedPostCount: 0,
          },
          meta: { timestamp, requestId: "request-1" },
        },
      );

    for (const account of [list.data.accounts[0], refresh.data.account]) {
      expect(account.statistics?.fetchedAt).toEqual(new Date(timestamp));
      expect(account.statistics?.refreshAttemptedAt).toEqual(
        new Date(timestamp),
      );
      expect(account.statistics?.historyFetchedAt).toEqual(new Date(timestamp));
    }
  });
});
