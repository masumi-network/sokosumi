import { studioAdCopyPrompts } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFound } from "@/helpers/error";
import type { StudioBatchAssetView } from "@/services/image-studio-assets.service";

const mocks = vi.hoisted(() => ({
  batchAssets: vi.fn(),
  access: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/services/image-studio-assets.service", () => ({
  listStudioBatchAssets: mocks.batchAssets,
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: mocks.access,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { adFeedback: { findMany: mocks.findMany, upsert: mocks.upsert } },
}));

import {
  getStudioComparePair,
  getStudioModelScoreboard,
  saveStudioPairwisePick,
  studioModelScoreboard,
} from "./studio-compare.service";

const SCOPE = {
  projectId: "project-a",
  workspaceId: "workspace-a",
  userId: "user-a",
};
const BATCH = { ...SCOPE, batchId: "batch-a" };
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function asset(
  id: string,
  overrides: Partial<StudioBatchAssetView> = {},
): StudioBatchAssetView {
  return {
    id,
    projectId: SCOPE.projectId,
    projectName: "Launch",
    batchId: BATCH.batchId,
    batchBrief: "A red vase",
    prompt: "A red vase",
    settings: { aspectRatio: "1:1" },
    rootId: id,
    parentId: null,
    version: 1,
    model: "model-a",
    width: 1024,
    height: 1024,
    bytes: 100,
    contentType: "image/png",
    mediaType: "IMAGE",
    durationSeconds: null,
    video: null,
    createdAt: new Date("2026-11-13T08:00:00Z"),
    jobId: id,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue(SCOPE);
  mocks.batchAssets.mockResolvedValue([
    asset(A),
    asset(B, { model: "model-b" }),
  ]);
  mocks.findMany.mockResolvedValue([]);
  mocks.upsert.mockImplementation(async ({ create, update }) => ({
    ...create,
    ...update,
    id: "pick-a",
  }));
});

describe("batch comparisons", () => {
  it("prefers different models and returns siblings in stable asset order", async () => {
    mocks.batchAssets.mockResolvedValue([
      asset(C, { model: "model-b" }),
      asset(B),
      asset(A),
    ]);

    const pair = await getStudioComparePair(BATCH);

    expect(pair).toMatchObject({ a: { id: A }, b: { id: C } });
    expect(mocks.batchAssets).toHaveBeenCalledWith(BATCH);
  });

  it("offers same-model variations after cross-model pairs", async () => {
    mocks.batchAssets.mockResolvedValue([asset(A), asset(B)]);
    expect(await getStudioComparePair(BATCH)).toMatchObject({
      a: { id: A },
      b: { id: B },
    });
  });

  it("recognizes generation and edit endpoints as the same model", async () => {
    mocks.batchAssets.mockResolvedValue([
      asset(A, { model: "fal-ai/flux-2-pro" }),
      asset(B, { model: "fal-ai/flux-2-pro/edit" }),
      asset(C, { model: "meta/muse-image/text-to-image" }),
    ]);
    expect(await getStudioComparePair(BATCH)).toMatchObject({
      a: { id: A },
      b: { id: C },
    });
  });

  it("does not repeat this user's pair in either orientation", async () => {
    mocks.findMany.mockResolvedValue([{ assetId: B, otherAssetId: A }]);

    expect(await getStudioComparePair(BATCH)).toBeNull();
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        ...SCOPE,
        batchId: BATCH.batchId,
        kind: "PAIRWISE",
      },
      select: { assetId: true, otherAssetId: true },
    });
  });

  it("returns done for an empty batch", async () => {
    mocks.batchAssets.mockResolvedValue([]);
    expect(await getStudioComparePair(BATCH)).toBeNull();
  });

  it("accepts different known variations of the same brief", async () => {
    const [first, second] = studioAdCopyPrompts("A red vase", 2, 5000);
    mocks.batchAssets.mockResolvedValue([
      asset(A, { prompt: first, batchBrief: first }),
      asset(B, { prompt: second, batchBrief: second }),
    ]);
    expect(await getStudioComparePair(BATCH)).not.toBeNull();
  });

  it.each([
    { settings: { aspectRatio: "9:16" } },
    { prompt: "A blue bowl" },
    { batchBrief: "A blue bowl" },
    { prompt: "A red vase\n\nAd variation: my custom direction" },
    { settings: { aspectRatio: "unknown" } },
  ])("rejects mismatched brief or placement (%j)", async (overrides) => {
    mocks.batchAssets.mockResolvedValue([asset(A), asset(B, overrides)]);

    expect(await getStudioComparePair(BATCH)).toBeNull();
    await expect(
      saveStudioPairwisePick({
        ...BATCH,
        assetId: A,
        otherAssetId: B,
        outcome: "A",
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("does not compare distinct products refined with the same instruction", async () => {
    mocks.batchAssets.mockResolvedValue([
      asset(A, { batchBrief: "A red vase", prompt: "Make the logo larger" }),
      asset(B, { batchBrief: "A blue bowl", prompt: "Make the logo larger" }),
    ]);
    expect(await getStudioComparePair(BATCH)).toBeNull();
  });

  it.each([A, C])(
    "rejects self or non-sibling assets (%s)",
    async (otherAssetId) => {
      await expect(
        saveStudioPairwisePick({
          ...BATCH,
          assetId: A,
          otherAssetId,
          outcome: "A",
        }),
      ).rejects.toMatchObject({ status: 422 });
      expect(mocks.upsert).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["A", "B"],
    ["B", "A"],
    ["TIE", "TIE"],
    ["BOTH_BAD", "BOTH_BAD"],
  ] as const)(
    "canonicalizes reversed %s as %s and upserts the same key",
    async (outcome, canonical) => {
      await saveStudioPairwisePick({
        ...BATCH,
        assetId: B.toUpperCase(),
        otherAssetId: A,
        outcome,
      });
      await saveStudioPairwisePick({
        ...BATCH,
        assetId: A,
        otherAssetId: B,
        outcome: canonical,
      });

      const first = mocks.upsert.mock.calls[0]?.[0];
      const second = mocks.upsert.mock.calls[1]?.[0];
      expect(first).toEqual(second);
      expect(first).toMatchObject({
        where: {
          userId_assetId_kind_otherAssetId: {
            userId: SCOPE.userId,
            assetId: A,
            otherAssetId: B,
            kind: "PAIRWISE",
          },
        },
        create: {
          ...BATCH,
          assetId: A,
          otherAssetId: B,
          outcome: canonical,
          kind: "PAIRWISE",
        },
        update: { outcome: canonical },
      });
    },
  );

  it("stops reads and writes when batch authorization fails", async () => {
    mocks.batchAssets.mockRejectedValue(notFound("Project not found"));
    await expect(getStudioComparePair(BATCH)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      saveStudioPairwisePick({
        ...BATCH,
        assetId: A,
        otherAssetId: B,
        outcome: "A",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("bounds the number of assets considered", async () => {
    mocks.batchAssets.mockResolvedValue(
      Array.from({ length: 13 }, () => asset(A)),
    );
    await expect(getStudioComparePair(BATCH)).rejects.toMatchObject({
      status: 413,
    });
  });
});

function pick(outcome: "A" | "B" | "TIE" | "BOTH_BAD") {
  return {
    outcome,
    asset: { model: "model-a" },
    otherAsset: { model: "model-b" },
  };
}

describe("project model scoreboard", () => {
  it("counts wins, ties as half, and both bad as zero for both models", () => {
    const result = studioModelScoreboard([
      pick("A"),
      pick("A"),
      pick("TIE"),
      pick("BOTH_BAD"),
    ]);
    expect(result.minimumComparisons).toBe(10);
    expect(result.models).toEqual([
      {
        model: "model-a",
        comparisons: 4,
        winRate: 0.625,
        elo: 1028,
        provisional: true,
      },
      {
        model: "model-b",
        comparisons: 4,
        winRate: 0.125,
        elo: 972,
        provisional: true,
      },
    ]);
  });

  it("uses an equal and opposite Elo update for the winner", () => {
    expect(studioModelScoreboard([pick("B")]).models).toEqual([
      {
        model: "model-b",
        comparisons: 1,
        winRate: 1,
        elo: 1016,
        provisional: true,
      },
      {
        model: "model-a",
        comparisons: 1,
        winRate: 0,
        elo: 984,
        provisional: true,
      },
    ]);
  });

  it("leaves Elo unchanged for ties at equal rating and for both bad", () => {
    const result = studioModelScoreboard([pick("TIE"), pick("BOTH_BAD")]);
    expect(result.models).toEqual([
      {
        model: "model-a",
        comparisons: 2,
        winRate: 0.25,
        elo: 1000,
        provisional: true,
      },
      {
        model: "model-b",
        comparisons: 2,
        winRate: 0.25,
        elo: 1000,
        provisional: true,
      },
    ]);
  });

  it("marks ten comparisons as no longer provisional", () => {
    const result = studioModelScoreboard(
      Array.from({ length: 10 }, () => pick("TIE")),
    );
    expect(result.models.every((model) => !model.provisional)).toBe(true);
  });

  it("ignores same-model picks and incomplete feedback", () => {
    expect(
      studioModelScoreboard([
        { ...pick("A"), otherAsset: { model: "model-a" } },
        { ...pick("A"), outcome: null },
        { ...pick("A"), otherAsset: null },
      ]).models,
    ).toEqual([]);
  });

  it("combines generation/edit endpoints and excludes their internal comparisons", () => {
    const result = studioModelScoreboard([
      { ...pick("A"), asset: { model: "fal-ai/flux-2-pro" } },
      { ...pick("A"), asset: { model: "fal-ai/flux-2-pro/edit" } },
      {
        ...pick("B"),
        asset: { model: "fal-ai/flux-2-pro" },
        otherAsset: { model: "fal-ai/flux-2-pro/edit" },
      },
    ]);
    expect(result.models).toHaveLength(2);
    expect(result.models[0]).toMatchObject({
      model: "flux-2-pro",
      comparisons: 2,
      winRate: 1,
    });
  });

  it("reads only this workspace/project in stable chronological order", async () => {
    mocks.findMany.mockResolvedValue([pick("A")]);
    expect((await getStudioModelScoreboard(SCOPE)).models).toHaveLength(2);
    expect(mocks.access).toHaveBeenCalledWith(SCOPE);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: SCOPE.projectId,
          workspaceId: SCOPE.workspaceId,
          kind: "PAIRWISE",
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("does not read feedback for a removed workspace member", async () => {
    mocks.access.mockRejectedValue(notFound("Project not found"));
    await expect(getStudioModelScoreboard(SCOPE)).rejects.toMatchObject({
      status: 404,
    });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
