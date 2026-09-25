import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  assetFindFirstMock,
  assetFindManyMock,
  reviewUpsertMock,
  reviewDeleteManyMock,
  jobFindManyMock,
  requireProjectAccessMock,
  getMock,
  getEnvMock,
} = vi.hoisted(() => ({
  assetFindFirstMock: vi.fn(),
  assetFindManyMock: vi.fn(),
  reviewUpsertMock: vi.fn(),
  reviewDeleteManyMock: vi.fn(),
  jobFindManyMock: vi.fn(),
  requireProjectAccessMock: vi.fn(),
  getMock: vi.fn(),
  getEnvMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@vercel/blob", () => ({ get: getMock }));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: requireProjectAccessMock,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectImageAsset: {
      findFirst: assetFindFirstMock,
      findMany: assetFindManyMock,
    },
    projectImageReview: {
      upsert: reviewUpsertMock,
      deleteMany: reviewDeleteManyMock,
    },
    projectImageJob: { findMany: jobFindManyMock },
  },
}));

import {
  listJobs,
  openAssetStream,
  reviewAsset,
} from "@/services/image-studio-assets.service";

const SCOPE = {
  projectId: "project-1",
  workspaceId: "workspace-1",
  userId: "user-1",
};

describe("image studio versions and reviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "t" });
    requireProjectAccessMock.mockResolvedValue(SCOPE);
  });

  it("records a decision against the one version it names", async () => {
    assetFindFirstMock.mockResolvedValue({
      id: "asset-2",
      rootId: "asset-1",
      parentId: "asset-1",
      version: 2,
      review: null,
    });

    await reviewAsset({
      ...SCOPE,
      assetId: "asset-2",
      decision: "APPROVED",
      feedback: "good",
    });

    expect(reviewUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assetId: "asset-2" } }),
    );
    // The upsert is keyed on the asset, so approving a refinement cannot
    // touch the version it came from.
    const call = reviewUpsertMock.mock.calls[0]![0];
    expect(JSON.stringify(call)).not.toContain("asset-1");
  });

  it("re-checks access before reading a version", async () => {
    assetFindFirstMock.mockResolvedValue({ id: "asset-1", review: null });
    requireProjectAccessMock.mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404 }),
    );

    await expect(
      reviewAsset({
        ...SCOPE,
        assetId: "asset-1",
        decision: "APPROVED",
        feedback: null,
      }),
    ).rejects.toThrow();
    expect(reviewUpsertMock).not.toHaveBeenCalled();
  });

  it("streams bytes only after re-authorizing, and never exposes a storage path", async () => {
    assetFindFirstMock.mockResolvedValue({
      blobPathname: "projects/p/image-studio/private-object",
      contentType: "image/png",
      checksum: "abc",
    });
    getMock.mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream(),
      blob: { contentType: "image/png", size: 42 },
    });

    const result = await openAssetStream({ ...SCOPE, assetId: "asset-1" });

    expect(requireProjectAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: "asset-1" }),
    );
    // Read as a private object; there is no URL that works without this route.
    expect(getMock).toHaveBeenCalledWith(
      "projects/p/image-studio/private-object",
      expect.objectContaining({ access: "private" }),
    );
    expect(Object.keys(result)).toEqual([
      "stream",
      "contentType",
      "size",
      "checksum",
    ]);
  });

  it("flags only an unconfirmed submission as possibly duplicating a charge", async () => {
    jobFindManyMock.mockResolvedValue([
      {
        id: "job-1",
        status: "SUBMISSION_UNCERTAIN",
        kind: "GENERATE",
        prompt: "p",
        error: null,
        parentAssetId: null,
        createdAt: new Date(),
        submittedAt: null,
        settledAt: null,
        asset: null,
      },
      {
        id: "job-2",
        status: "FAILED",
        kind: "GENERATE",
        prompt: "p",
        error: "bad prompt",
        parentAssetId: null,
        createdAt: new Date(),
        submittedAt: null,
        settledAt: new Date(),
        asset: null,
      },
    ]);

    const jobs = await listJobs({ ...SCOPE, limit: 10 });

    expect(jobs[0]!.retryMayDuplicateCharge).toBe(true);
    expect(jobs[1]!.retryMayDuplicateCharge).toBe(false);
  });
});
