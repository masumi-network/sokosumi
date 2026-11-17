import { beforeEach, describe, expect, it, vi } from "vitest";

import { adEvalAsset, adFeedback } from "@/test-fixtures/ad-evals";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  default: { projectImageAsset: { findMany } },
}));

import {
  adJudgeScores,
  getAdminAdEvalsDashboard,
  loadAdEvalAssets,
} from "./ad-evals.service";

function ratedAssets(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const workspaceId = `workspace-${index}`;
    return adEvalAsset({
      id: `asset-${index}`,
      workspaceId,
      adFeedback: [adFeedback({ workspaceId, thumb: index === 0 ? -1 : 1 })],
      adEvals: [
        {
          workspaceId,
          overall: index === 0 ? 1 : 4,
          judge: {
            criteria: {
              composition: {
                score: index === 0 ? 1 : 5,
                reason: "Private brand text",
              },
            },
          },
        },
      ],
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
});

describe("admin ad-evals aggregation", () => {
  it("applies workspace improvement consent before reading data", async () => {
    const dashboard = await getAdminAdEvalsDashboard();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          mediaType: "IMAGE",
          workspace: { adDataConsent: { is: { shareForImprovement: true } } },
        }),
      }),
    );
    expect(dashboard).toEqual({
      leaderboard: [],
      agreement: [],
      minimumWorkspaces: 5,
    });
  });

  it("requires both consent flags for training data", async () => {
    await loadAdEvalAssets(true);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspace: {
            adDataConsent: {
              is: { shareForImprovement: true, allowTraining: true },
            },
          },
        }),
      }),
    );
  });

  it("suppresses rates, means and every CI below five contributing workspaces", async () => {
    findMany.mockResolvedValue(ratedAssets(4));
    const { leaderboard } = await getAdminAdEvalsDashboard();
    expect(leaderboard).toHaveLength(1);
    expect(leaderboard[0]).toMatchObject({
      n: 4,
      workspaceCount: 4,
      suppressed: true,
      thumbRate: null,
      pairwiseWinRate: null,
      judgeMean: null,
      thumbRateCi: null,
      pairwiseWinRateCi: null,
      judgeMeanCi: null,
    });
  });

  it("reports ratings and judge means with counts and 95% intervals at five workspaces", async () => {
    findMany.mockResolvedValue(ratedAssets(5));
    const { leaderboard, agreement } = await getAdminAdEvalsDashboard();
    expect(leaderboard[0]).toMatchObject({
      model: "ideogram-v3",
      template: "ad",
      aspect: "1:1",
      n: 5,
      thumbN: 5,
      pairwiseN: 0,
      judgeN: 5,
      suppressed: false,
      thumbRate: 0.8,
      judgeMean: 3.4,
      thumbRateCi: { lower: expect.any(Number), upper: expect.any(Number) },
    });
    expect(agreement).toContainEqual({
      criterion: "composition",
      signal: "thumb",
      rho: 1,
      n: 5,
      lowAgreement: false,
    });
  });

  it("does not unlock one workspace's metric with unscored assets or another metric", async () => {
    const assets = ratedAssets(5);
    assets[0].adEvals = [];
    for (const asset of assets.slice(1)) asset.adFeedback = [];
    assets.push(
      adEvalAsset({
        id: "event-only",
        workspaceId: "unscored",
        adEvents: [
          { workspaceId: "unscored", type: "posted", createdAt: new Date() },
        ],
      }),
    );
    findMany.mockResolvedValue(assets);
    const { leaderboard } = await getAdminAdEvalsDashboard();
    expect(leaderboard[0]).toMatchObject({
      n: 5,
      workspaceCount: 5,
      thumbN: 1,
      judgeN: 4,
      thumbRate: null,
      judgeMean: null,
      thumbRateCi: null,
      judgeMeanCi: null,
    });
  });

  it("correlates pairwise judge differences with signed human choices, including ties", async () => {
    const assets = [1, 0, -1].flatMap((label, index) => {
      const a = adEvalAsset({
        id: `a-${index}`,
        adEvals: [
          {
            workspaceId: "workspace-a",
            overall: 3 + label,
            judge: { criteria: { composition: { score: 3 + label } } },
          },
        ],
        adFeedback: [
          adFeedback({
            kind: "PAIRWISE",
            otherAssetId: `b-${index}`,
            thumb: null,
            outcome: label === 1 ? "A" : label === -1 ? "B" : "TIE",
          }),
        ],
      });
      const b = adEvalAsset({
        id: `b-${index}`,
        model: "muse-image",
        adEvals: [
          {
            workspaceId: "workspace-a",
            overall: 3,
            judge: { criteria: { composition: { score: 3 } } },
          },
        ],
      });
      return [a, b];
    });
    findMany.mockResolvedValue(assets);
    const { agreement } = await getAdminAdEvalsDashboard();
    expect(agreement).toContainEqual({
      criterion: "composition",
      signal: "pairwise",
      rho: 1,
      n: 3,
      lowAgreement: false,
    });
  });

  it("flags weak judge agreement and rejects cross-workspace feedback/evaluations", async () => {
    const assets = ratedAssets(5);
    assets[0].adFeedback[0].thumb = 1;
    assets[1].adFeedback[0].thumb = -1;
    assets[2].adFeedback.push(adFeedback({ workspaceId: "other-workspace" }));
    assets[3].adEvals = [
      { workspaceId: "other-workspace", overall: 5, judge: null },
    ];
    findMany.mockResolvedValue(assets);
    const { agreement } = await getAdminAdEvalsDashboard();
    expect(
      agreement.find((row) => row.criterion === "composition"),
    ).toMatchObject({ n: 4, lowAgreement: true });
    expect(adJudgeScores(assets[3])).toEqual({});
  });
});
