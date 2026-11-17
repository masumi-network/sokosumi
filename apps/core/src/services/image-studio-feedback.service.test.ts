import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  asset: vi.fn(),
  hide: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  thumbs: vi.fn(),
  mine: vi.fn(),
  events: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: mocks.access,
}));
vi.mock("./image-studio-events.service", () => ({
  recordStudioAdEvent: mocks.record,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectImageAsset: { findFirst: mocks.asset, updateMany: mocks.hide },
    adFeedback: {
      upsert: mocks.upsert,
      update: mocks.update,
      deleteMany: mocks.remove,
      groupBy: mocks.thumbs,
      findMany: mocks.mine,
    },
    adEvent: { groupBy: mocks.events },
  },
}));

import {
  getStudioAssetRatings,
  hideStudioAsset,
  recordStudioAssetLightboxView,
  setStudioAssetFeedback,
} from "./image-studio-feedback.service";

const SCOPE = {
  projectId: "project-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  assetId: "asset-1",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue(SCOPE);
  mocks.asset.mockResolvedValue({
    id: SCOPE.assetId,
    hiddenAt: null,
    job: { batchId: "batch-1", batchSlot: null },
  });
  mocks.hide.mockResolvedValue({ count: 1 });
  mocks.thumbs.mockResolvedValue([]);
  mocks.mine.mockResolvedValue([]);
  mocks.events.mockResolvedValue([]);
});

describe("studio feedback", () => {
  it("checks current project membership before reading or writing an asset", async () => {
    mocks.access.mockRejectedValue(new Error("Project not found"));
    await expect(
      setStudioAssetFeedback({ ...SCOPE, thumb: 1 }),
    ).rejects.toThrow("Project not found");
    expect(mocks.asset).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("never rates an asset outside the project and workspace", async () => {
    mocks.asset.mockResolvedValue(null);
    await expect(
      setStudioAssetFeedback({ ...SCOPE, thumb: 1 }),
    ).rejects.toThrow("Image not found");
    expect(mocks.asset).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "asset-1",
          projectId: "project-1",
          workspaceId: "workspace-1",
        },
      }),
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("upserts through the unique person/asset thumb key for retries and opposite thumbs", async () => {
    await setStudioAssetFeedback({ ...SCOPE, thumb: 1 });
    await setStudioAssetFeedback({
      ...SCOPE,
      thumb: -1,
      reasons: ["ugly", "ugly"],
      comment: "  Try softer light  ",
    });
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.upsert).toHaveBeenLastCalledWith({
      where: {
        userId_assetId: { userId: "user-1", assetId: "asset-1" },
        kind: "THUMB",
      },
      create: {
        thumb: -1,
        reasons: ["ugly"],
        comment: "Try softer light",
        userId: "user-1",
        assetId: "asset-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        kind: "THUMB",
        batchId: "batch-1",
      },
      update: { thumb: -1, reasons: ["ugly"], comment: "Try softer light" },
    });
  });

  it("retries a concurrent first vote against the existing thumb without changing pairwise feedback", async () => {
    mocks.upsert.mockRejectedValue({ code: "P2002" });
    await setStudioAssetFeedback({ ...SCOPE, thumb: -1 });
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      where: {
        userId_assetId: { userId: "user-1", assetId: "asset-1" },
        kind: "THUMB",
      },
      data: { thumb: -1, reasons: [], comment: null },
    });
  });

  it("does not swallow a failed feedback write", async () => {
    mocks.upsert.mockRejectedValue(new Error("write failed"));
    await expect(
      setStudioAssetFeedback({ ...SCOPE, thumb: 1 }),
    ).rejects.toThrow("write failed");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("clears only this person's THUMB feedback when toggled off", async () => {
    await setStudioAssetFeedback({ ...SCOPE, thumb: null });
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({
      where: { userId: "user-1", assetId: "asset-1", kind: "THUMB" },
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("returns team counts and only the caller's reasons and comment", async () => {
    mocks.thumbs.mockResolvedValue([
      { assetId: "asset-1", thumb: 1, _count: { _all: 3 } },
      { assetId: "asset-1", thumb: -1, _count: { _all: 1 } },
    ]);
    mocks.mine.mockResolvedValue([
      { assetId: "asset-1", thumb: 1, reasons: ["great"], comment: "Use it" },
    ]);
    mocks.events.mockResolvedValue([
      { assetId: "asset-1", type: "downloaded", _count: { _all: 1 } },
    ]);
    const rating = (await getStudioAssetRatings(["asset-1"], "user-1")).get(
      "asset-1",
    );
    expect(rating).toEqual({
      myThumb: 1,
      myReasons: ["great"],
      myComment: "Use it",
      thumbsUp: 3,
      thumbsDown: 1,
      score: 5 / 7,
    });
    expect(mocks.mine).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assetId: { in: ["asset-1"] },
          userId: "user-1",
          kind: "THUMB",
        },
      }),
    );
  });

  it("authorizes lightbox events before logging them", async () => {
    await recordStudioAssetLightboxView(SCOPE);
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith({
      ...SCOPE,
      type: "viewed_lightbox",
    });
  });

  it("hides once and logs the successful transition", async () => {
    await hideStudioAsset(SCOPE);
    expect(mocks.hide).toHaveBeenCalledWith({
      where: {
        id: "asset-1",
        projectId: "project-1",
        workspaceId: "workspace-1",
        hiddenAt: null,
      },
      data: { hiddenAt: expect.any(Date) },
    });
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith({
      ...SCOPE,
      type: "hidden",
    });
    mocks.record.mockClear();
    mocks.hide.mockResolvedValue({ count: 0 });
    await hideStudioAsset(SCOPE);
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
