import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Settling a job exactly once.
 *
 * An independent review ran six settlers against one job on a real database:
 * one asset row was created, and six objects were written to storage. The row
 * was deduplicated, but only after every settler had already downloaded the
 * image and uploaded its own copy, leaving five with nothing referencing them.
 */

const {
  jobFindUniqueMock,
  jobUpdateMock,
  jobUpdateManyMock,
  assetFindUniqueMock,
  assetFindFirstMock,
  assetCreateMock,
  downloadImageMock,
  putMock,
  requireProjectAccessForUserMock,
} = vi.hoisted(() => ({
  jobFindUniqueMock: vi.fn(),
  jobUpdateMock: vi.fn(),
  jobUpdateManyMock: vi.fn(),
  assetFindUniqueMock: vi.fn(),
  assetFindFirstMock: vi.fn(),
  assetCreateMock: vi.fn(),
  downloadImageMock: vi.fn(),
  putMock: vi.fn(),
  requireProjectAccessForUserMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({ FAL_KEY: "k", BLOB_READ_WRITE_TOKEN: "t" }),
  getBetterAuthPublicBaseUrl: () => "https://core.example.com",
}));
vi.mock("@vercel/blob", () => ({ put: putMock }));
vi.mock("@/lib/db/prisma", () => {
  const client = {
    projectImageJob: {
      findUnique: jobFindUniqueMock,
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: jobUpdateMock,
      updateMany: jobUpdateManyMock,
      count: vi.fn(),
      create: vi.fn(),
    },
    projectImageAsset: {
      findUnique: assetFindUniqueMock,
      findFirst: assetFindFirstMock,
      findMany: vi.fn().mockResolvedValue([]),
      create: assetCreateMock,
    },
    project: { findUnique: vi.fn() },
    $transaction: (run: (tx: unknown) => unknown) => run(client),
  };
  return { default: client };
});
vi.mock("@/lib/db/transaction", async () => ({
  ...(await vi.importActual<typeof import("@/lib/db/transaction")>(
    "@/lib/db/transaction",
  )),
  serializableTransaction: async (run: (tx: unknown) => Promise<unknown>) =>
    await run((await import("@/lib/db/prisma")).default),
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: vi.fn(),
  requireProjectAccessForUser: requireProjectAccessForUserMock,
}));
vi.mock("@/lib/image-studio/fal-client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/image-studio/fal-client")>(
    "@/lib/image-studio/fal-client",
  )),
  downloadImage: downloadImageMock,
}));
vi.mock("@/services/image-studio-assets.service", () => ({
  readAssetBytes: vi.fn(),
}));

import { settleWithImage } from "@/services/image-studio-jobs.service";

const JOB = {
  id: "job-1",
  projectId: "project-1",
  workspaceId: "workspace-1",
  requestedByUserId: "user-1",
  model: "fal-ai/gemini-3.1-flash-image-preview",
  kind: "GENERATE",
  prompt: "a cup",
  settings: {},
  parentAssetId: null,
  referenceAssetIds: [],
  status: "QUEUED",
  falRequestId: "fal-1",
  cancelRequestedAt: null,
  createdAt: new Date(),
  asset: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  jobFindUniqueMock.mockResolvedValue(JOB);
  requireProjectAccessForUserMock.mockResolvedValue({
    projectId: "project-1",
    workspaceId: "workspace-1",
    userId: "user-1",
  });
  downloadImageMock.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "image/png",
  });
  putMock.mockResolvedValue({ pathname: "projects/p/image-studio/job-1-abc" });
  assetFindUniqueMock.mockResolvedValue(null);
  assetFindFirstMock.mockResolvedValue(null);
  assetCreateMock.mockResolvedValue({ id: "asset-1" });
  jobUpdateMock.mockResolvedValue({
    pollFailures: 1,
    submittedAt: new Date(),
    createdAt: new Date(),
  });
});

describe("concurrent settlement", () => {
  it("does the paid work once when many settlers race one job", async () => {
    // Only the first caller wins the lease; the rest are refused before they
    // reach the network.
    let claims = 0;
    jobUpdateManyMock.mockImplementation(async (args: { data: unknown }) => {
      const data = args.data as Record<string, unknown>;
      const isLeaseClaim =
        Object.keys(data).length === 1 && "submitLeaseAt" in data;
      if (!isLeaseClaim) return { count: 1 };
      claims += 1;
      return { count: claims === 1 ? 1 : 0 };
    });

    await Promise.all(
      Array.from({ length: 6 }, () =>
        settleWithImage("job-1", "https://v3b.fal.media/files/a.png"),
      ),
    );

    expect(downloadImageMock).toHaveBeenCalledTimes(1);
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(assetCreateMock).toHaveBeenCalledTimes(1);
  });

  it("writes one object per job, so a loser cannot leave an orphan", async () => {
    jobUpdateManyMock.mockResolvedValue({ count: 1 });

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    const options = putMock.mock.calls[0]![2];
    // A random suffix meant each settler wrote its own object and the losers'
    // copies were left behind unreferenced.
    expect(options.addRandomSuffix).toBe(false);
    expect(options.allowOverwrite).toBe(true);
    expect(options.access).toBe("private");
    expect(putMock.mock.calls[0]![0]).toContain("job-1");
  });
});
