import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setFeedback: vi.fn(),
  hideAsset: vi.fn(),
  recordView: vi.fn(),
}));
vi.mock("@/middleware/auth-middleware", () => ({
  withSession: (handler: (input: object) => Promise<unknown>) => handler,
}));
vi.mock("@/lib/services/image-studio.service", () => ({
  imageStudioService: mocks,
}));
vi.mock("@/lib/clients/core.client", () => ({
  toCoreApiActionError: () => ({ code: "FORBIDDEN", message: "Access denied" }),
}));

import {
  hideStudioAsset,
  rateStudioAsset,
  recordStudioAssetView,
} from "./feedback";

const INPUT = { projectId: "project", assetId: "asset" };
beforeEach(() => vi.resetAllMocks());

describe("studio feedback actions", () => {
  it("passes a rating including chips and comment to Core", async () => {
    const rating = {
      myThumb: -1,
      myReasons: ["bad text"],
      myComment: "Spelling",
      thumbsUp: 2,
      thumbsDown: 1,
      score: 0.4,
    };
    mocks.setFeedback.mockResolvedValue(rating);
    const feedback = {
      thumb: -1 as const,
      reasons: ["bad text" as const],
      comment: "Spelling",
    };
    expect(await rateStudioAsset({ ...INPUT, feedback })).toEqual({
      ok: true,
      value: rating,
    });
    expect(mocks.setFeedback).toHaveBeenCalledWith(
      "project",
      "asset",
      feedback,
    );
  });

  it("returns a serializable rating error", async () => {
    mocks.setFeedback.mockRejectedValue(new Error("Access denied"));
    expect(
      await rateStudioAsset({ ...INPUT, feedback: { thumb: null } }),
    ).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "Access denied" },
    });
  });

  it("hides through Core and maps a failure", async () => {
    expect(await hideStudioAsset(INPUT)).toEqual({ ok: true, value: null });
    expect(mocks.hideAsset).toHaveBeenCalledWith("project", "asset");
    mocks.hideAsset.mockRejectedValue(new Error("Access denied"));
    expect(await hideStudioAsset(INPUT)).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "Access denied" },
    });
  });

  it("keeps view event failures out of the viewing action", async () => {
    mocks.recordView.mockRejectedValue(new Error("Unavailable"));
    await expect(recordStudioAssetView(INPUT)).resolves.toBeUndefined();
    expect(mocks.recordView).toHaveBeenCalledWith("project", "asset");
  });
});
