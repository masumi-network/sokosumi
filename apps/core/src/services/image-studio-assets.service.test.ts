import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  assetFindFirstMock,
  assetFindManyMock,
  assetGroupByMock,
  jobFindManyMock,
  requireProjectAccessMock,
  requireWorkspaceAccessMock,
  getMock,
  getEnvMock,
  feedbackGroupByMock,
  feedbackFindManyMock,
  eventGroupByMock,
} = vi.hoisted(() => ({
  assetFindFirstMock: vi.fn(),
  assetFindManyMock: vi.fn(),
  assetGroupByMock: vi.fn(),
  jobFindManyMock: vi.fn(),
  requireProjectAccessMock: vi.fn(),
  requireWorkspaceAccessMock: vi.fn(),
  getMock: vi.fn(),
  getEnvMock: vi.fn(),
  feedbackGroupByMock: vi.fn(),
  feedbackFindManyMock: vi.fn(),
  eventGroupByMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@vercel/blob", () => ({ get: getMock }));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: requireProjectAccessMock,
  requireWorkspaceAccess: requireWorkspaceAccessMock,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectImageAsset: {
      findFirst: assetFindFirstMock,
      findMany: assetFindManyMock,
      groupBy: assetGroupByMock,
    },
    projectImageJob: { findMany: jobFindManyMock },
    adFeedback: {
      groupBy: feedbackGroupByMock,
      findMany: feedbackFindManyMock,
    },
    adEvent: { groupBy: eventGroupByMock },
  },
}));

import {
  listJobs,
  listRecentStudioProjects,
  listStudioBatchAssets,
  openAssetStream,
  toJobView,
} from "@/services/image-studio-assets.service";

const SCOPE = {
  projectId: "project-1",
  workspaceId: "workspace-1",
  userId: "user-1",
};

describe("image studio versions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Shared public-store token present, studio private-store token present
    // and different: the studio must use its own.
    getEnvMock.mockReturnValue({
      BLOB_READ_WRITE_TOKEN: "shared-public-store-token",
      IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN: "studio-private-store-token",
    });
    requireProjectAccessMock.mockResolvedValue(SCOPE);
    feedbackGroupByMock.mockResolvedValue([]);
    feedbackFindManyMock.mockResolvedValue([]);
    eventGroupByMock.mockResolvedValue([]);
  });

  it("streams bytes only after re-authorizing, and never exposes a storage path", async () => {
    assetFindFirstMock.mockResolvedValue({
      blobPathname: "projects/p/image-studio/stored-object",
      contentType: "image/png",
      mediaType: "IMAGE",
      checksum: "abc",
    });
    getMock.mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream(),
      headers: new Headers(),
      blob: { contentType: "image/png", size: 42 },
    });

    const result = await openAssetStream({ ...SCOPE, assetId: "asset-1" });

    // Two independent gates. This call decides whether *this caller* may have
    // the bytes; `access: "private"` on the studio's own store is what stops
    // everyone who never comes through this route at all.
    expect(requireProjectAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: "asset-1" }),
    );
    expect(getMock).toHaveBeenCalledWith(
      "projects/p/image-studio/stored-object",
      expect.objectContaining({
        access: "private",
        token: "studio-private-store-token",
      }),
    );
    expect(Object.keys(result)).toEqual([
      "stream",
      "contentType",
      "mediaType",
      "size",
      "checksum",
      "contentRange",
    ]);
    expect(result.contentRange).toBeNull();
    expect(result.mediaType).toBe("IMAGE");
  });

  it("passes a video's byte range to the store and reports the partial answer", async () => {
    assetFindFirstMock.mockResolvedValue({
      blobPathname: "projects/p/image-studio/clip",
      contentType: "video/mp4",
      mediaType: "VIDEO",
      checksum: "abc",
    });
    getMock.mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream(),
      headers: new Headers({ "content-range": "bytes 0-99/1000" }),
      blob: { contentType: "video/mp4", size: 100 },
    });

    const result = await openAssetStream({
      ...SCOPE,
      assetId: "asset-1",
      range: "bytes=0-99",
    });

    expect(getMock).toHaveBeenCalledWith(
      "projects/p/image-studio/clip",
      expect.objectContaining({
        headers: { "accept-encoding": "identity", range: "bytes=0-99" },
      }),
    );
    expect(result.contentRange).toBe("bytes 0-99/1000");
    expect(result.size).toBe(100);
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

  it.each([
    {},
    { templateId: null, creativeDirection: null, variationIndex: null },
    {
      templateId: "social-post",
      creativeDirection: "lifestyle",
      variationIndex: 0,
    },
  ])(
    "returns only known prompt metadata for retries (%j)",
    async (metadata) => {
      const job: Parameters<typeof toJobView>[0] = {
        id: "job-1",
        projectId: SCOPE.projectId,
        status: "FAILED",
        kind: "GENERATE",
        model: "test-model",
        prompt: "A vase",
        settings: {},
        referenceAssetIds: [],
        error: "Please try again",
        failureReason: "provider_error",
        parentAssetId: null,
        createdAt: new Date(),
        submittedAt: null,
        settledAt: null,
        cancelRequestedAt: null,
        chargedCents: null,
        transactionId: null,
        asset: null,
        ...metadata,
      };
      jobFindManyMock.mockResolvedValue([job]);

      const [view] = await listJobs({ ...SCOPE, limit: 10 });

      expect(jobFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            templateId: true,
            creativeDirection: true,
            variationIndex: true,
          }),
        }),
      );
      if (metadata.variationIndex != null) {
        expect(view).toMatchObject(metadata);
      } else {
        expect(view).not.toHaveProperty("templateId");
        expect(view).not.toHaveProperty("creativeDirection");
        expect(view).not.toHaveProperty("variationIndex");
      }
    },
  );
});

describe("image studio batch siblings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireProjectAccessMock.mockResolvedValue(SCOPE);
    feedbackGroupByMock.mockResolvedValue([]);
    feedbackFindManyMock.mockResolvedValue([]);
    eventGroupByMock.mockResolvedValue([]);
  });

  const rawAsset = {
    id: "asset-1",
    projectId: SCOPE.projectId,
    project: { name: "Launch" },
    prompt: "Make the logo larger",
    model: "model-a",
    settings: { aspectRatio: "1:1" },
    mediaType: "IMAGE",
    createdAt: new Date("2026-11-13T08:00:00Z"),
    headline: null,
    job: { batchId: null, batchSlot: { batchId: "batch-1" } },
  };

  it("retains the original slot brief alongside the latest successful refinement", async () => {
    jobFindManyMock.mockResolvedValue([
      {
        prompt: "A red vase",
        asset: { ...rawAsset, id: "original", prompt: "A red vase" },
        batchRefinements: [{ asset: rawAsset }],
      },
    ]);

    const result = await listStudioBatchAssets({
      ...SCOPE,
      batchId: "batch-1",
    });

    expect(result).toMatchObject([
      {
        id: "asset-1",
        batchId: "batch-1",
        batchBrief: "A red vase",
        prompt: "Make the logo larger",
      },
    ]);
    expect(jobFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: SCOPE.projectId,
          workspaceId: SCOPE.workspaceId,
          batchId: "batch-1",
        }),
        select: expect.objectContaining({ prompt: true }),
      }),
    );
  });

  it("does not read private siblings after project access is denied", async () => {
    requireProjectAccessMock.mockRejectedValueOnce(
      new Error("Project not found"),
    );
    jobFindManyMock.mockClear();
    await expect(
      listStudioBatchAssets({ ...SCOPE, batchId: "batch-1" }),
    ).rejects.toThrow("Project not found");
    expect(jobFindManyMock).not.toHaveBeenCalled();
  });
});

describe("listRecentStudioProjects", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checks membership, then reads only open, unhidden projects' images", async () => {
    const latestAt = new Date("2026-11-11T10:00:00.000Z");
    assetGroupByMock.mockResolvedValue([
      {
        projectId: "project-1",
        _count: { _all: 24 },
        _max: { createdAt: latestAt },
      },
      {
        projectId: "project-2",
        _count: { _all: 3 },
        _max: { createdAt: latestAt },
      },
    ]);
    assetFindFirstMock
      .mockResolvedValueOnce({
        id: "asset-9",
        createdAt: latestAt,
        project: { name: "Autumn menu" },
      })
      // Closed or hidden between the two reads.
      .mockResolvedValueOnce(null);

    const projects = await listRecentStudioProjects({
      workspaceId: "workspace-1",
      userId: "user-1",
      limit: 3,
    });

    expect(requireWorkspaceAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-1", userId: "user-1" }),
    );
    expect(assetGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: "workspace-1",
          mediaType: "IMAGE",
          project: {
            closedAt: null,
            hides: { none: { userId: "user-1" } },
          },
        },
        take: 3,
      }),
    );
    expect(projects).toEqual([
      {
        projectId: "project-1",
        projectName: "Autumn menu",
        imageCount: 24,
        latestAt,
        latestImageId: "asset-9",
      },
    ]);
  });

  it("reads nothing for a caller who is not a member", async () => {
    requireWorkspaceAccessMock.mockRejectedValueOnce(new Error("not found"));
    await expect(
      listRecentStudioProjects({
        workspaceId: "workspace-1",
        userId: "user-1",
        limit: 3,
      }),
    ).rejects.toThrow("not found");
    expect(assetGroupByMock).not.toHaveBeenCalled();
  });
});
