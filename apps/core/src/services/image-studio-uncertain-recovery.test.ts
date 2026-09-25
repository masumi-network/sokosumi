import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Recovering a job we lost contact with.
 *
 * An independent review aged a real queued job to seven hours, returned one
 * unreachable read, then made the provider healthy again: polling, the cron and
 * the completion callback all refused to look at the job ever again, so a paid
 * image became permanently unreachable. Uncertainty is not a verdict, and a
 * request id we still hold is a question we can still ask.
 */

const {
  jobFindUniqueMock,
  jobUpdateMock,
  jobUpdateManyMock,
  jobFindManyMock,
  fetchQueueStatusMock,
  downloadImageMock,
  putMock,
  assetCreateMock,
  assetFindUniqueMock,
  assetFindFirstMock,
  requireProjectAccessForUserMock,
  submitToQueueMock,
} = vi.hoisted(() => ({
  jobFindUniqueMock: vi.fn(),
  jobUpdateMock: vi.fn(),
  jobUpdateManyMock: vi.fn(),
  jobFindManyMock: vi.fn(),
  fetchQueueStatusMock: vi.fn(),
  downloadImageMock: vi.fn(),
  putMock: vi.fn(),
  assetCreateMock: vi.fn(),
  assetFindUniqueMock: vi.fn(),
  assetFindFirstMock: vi.fn(),
  requireProjectAccessForUserMock: vi.fn(),
  submitToQueueMock: vi.fn(),
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
      findMany: jobFindManyMock,
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
  fetchQueueStatus: fetchQueueStatusMock,
  downloadImage: downloadImageMock,
  submitToQueue: submitToQueueMock,
}));
vi.mock("@/services/image-studio-assets.service", () => ({
  readAssetBytes: vi.fn(),
}));

import {
  reconcileJob,
  settleWithImage,
} from "@/services/image-studio-jobs.service";

function uncertainJob(overrides: Record<string, unknown> = {}) {
  return {
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
    // We gave up waiting, but we kept the request id.
    status: "SUBMISSION_UNCERTAIN",
    falRequestId: "fal-1",
    cancelRequestedAt: null,
    createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
    submittedAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
    statusUnreachableSince: new Date(Date.now() - 7 * 60 * 60 * 1000),
    asset: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  jobUpdateManyMock.mockResolvedValue({ count: 1 });
  jobUpdateMock.mockResolvedValue({ statusUnreachableSince: null });
  jobFindManyMock.mockResolvedValue([]);
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
});

describe("a job we stopped hearing about", () => {
  it("is polled again, and comes back when the provider still has it", async () => {
    jobFindUniqueMock.mockResolvedValue(uncertainJob());
    fetchQueueStatusMock.mockResolvedValue({ kind: "in_progress" });

    await reconcileJob("job-1");

    // The guard used to refuse anything but QUEUED/RUNNING, so this never ran.
    expect(fetchQueueStatusMock).toHaveBeenCalledTimes(1);
    const written = jobUpdateManyMock.mock.calls.map((call) => call[0].data);
    expect(written.some((data) => data.status === "RUNNING")).toBe(true);
  });

  it("accepts a completion that arrives after the outage", async () => {
    jobFindUniqueMock.mockResolvedValue(uncertainJob());

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    // The webhook takes this same path.
    expect(downloadImageMock).toHaveBeenCalledTimes(1);
    expect(assetCreateMock).toHaveBeenCalledTimes(1);
  });

  it("is never re-submitted by recovery — that is the part that costs money", async () => {
    jobFindUniqueMock.mockResolvedValue(uncertainJob());
    fetchQueueStatusMock.mockResolvedValue({ kind: "in_queue" });

    await reconcileJob("job-1");

    expect(submitToQueueMock).not.toHaveBeenCalled();
  });
});

describe("the grace period", () => {
  it("bounds the outage, not the age of the request", async () => {
    // Eight hours old, but this is the first read that failed.
    jobFindUniqueMock.mockResolvedValue(
      uncertainJob({ status: "QUEUED", statusUnreachableSince: null }),
    );
    fetchQueueStatusMock.mockResolvedValue({
      kind: "unreachable",
      message: "socket hang up",
    });
    jobUpdateMock.mockResolvedValue({ statusUnreachableSince: null });

    await reconcileJob("job-1");

    const written = jobUpdateManyMock.mock.calls.map((call) => call[0].data);
    expect(written.some((data) => data.status === "SUBMISSION_UNCERTAIN")).toBe(
      false,
    );
    // This dependency's clock starts instead.
    expect(
      written.some((data) => data.statusUnreachableSince instanceof Date),
    ).toBe(true);
  });

  it("says what was actually unreachable", async () => {
    jobFindUniqueMock.mockResolvedValue(uncertainJob({ status: "QUEUED" }));
    requireProjectAccessForUserMock.mockRejectedValue(
      new Error("connection pool timeout"),
    );
    jobUpdateMock.mockResolvedValue({
      authUnreachableSince: new Date(Date.now() - 7 * 60 * 60 * 1000),
    });

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    const source = jobUpdateMock.mock.calls[0]![0].data.unreachableSource;
    expect(source).toBe("authorization");
    const written = jobUpdateManyMock.mock.calls.map((call) => call[0].data);
    const message = written.find((data) => data.error)?.error as string;
    // Telling somebody the provider was down for six hours when one database
    // lookup failed is a lie.
    expect(message).not.toContain("provider could not be reached");
    expect(message).toContain("belongs to");
  });

  it("forgets the outage once a read gets through", async () => {
    jobFindUniqueMock.mockResolvedValue(uncertainJob());
    fetchQueueStatusMock.mockResolvedValue({ kind: "in_queue" });

    await reconcileJob("job-1");

    const written = jobUpdateManyMock.mock.calls.map((call) => call[0].data);
    // Only the dependency that answered is cleared.
    expect(written.some((data) => data.statusUnreachableSince === null)).toBe(
      true,
    );
    expect(written.some((data) => data.authUnreachableSince === null)).toBe(
      false,
    );
  });
});
