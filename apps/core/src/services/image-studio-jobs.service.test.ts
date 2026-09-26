import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  jobCountMock,
  jobCreateMock,
  jobFindUniqueMock,
  jobFindUniqueOrThrowMock,
  jobUpdateMock,
  jobUpdateManyMock,
  jobFindManyMock,
  assetFindUniqueMock,
  assetFindManyMock,
  getEnvMock,
  submitToQueueMock,
  uploadReferenceMock,
  readAssetBytesMock,
  requireProjectAccessMock,
} = vi.hoisted(() => ({
  jobCountMock: vi.fn(),
  jobCreateMock: vi.fn(),
  jobFindUniqueMock: vi.fn(),
  jobFindUniqueOrThrowMock: vi.fn(),
  jobUpdateMock: vi.fn(),
  jobUpdateManyMock: vi.fn(),
  jobFindManyMock: vi.fn(),
  assetFindUniqueMock: vi.fn(),
  assetFindManyMock: vi.fn(),
  getEnvMock: vi.fn(),
  submitToQueueMock: vi.fn(),
  uploadReferenceMock: vi.fn(),
  readAssetBytesMock: vi.fn(),
  requireProjectAccessMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
  getBetterAuthPublicBaseUrl: () => "http://localhost:3001",
}));

vi.mock("@/lib/db/prisma", () => {
  const client = {
    projectImageJob: {
      count: jobCountMock,
      create: jobCreateMock,
      findUnique: jobFindUniqueMock,
      findUniqueOrThrow: jobFindUniqueOrThrowMock,
      findMany: jobFindManyMock,
      update: jobUpdateMock,
      updateMany: jobUpdateManyMock,
    },
    projectImageAsset: {
      findUnique: assetFindUniqueMock,
      findMany: assetFindManyMock,
      findFirst: vi.fn(),
      create: vi.fn(),
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
  // Run the body against the same client. What the tests assert is that the
  // count and the insert go through one atomic step at all.
  serializableTransaction: async (run: (tx: unknown) => Promise<unknown>) => {
    const prisma = (await import("@/lib/db/prisma")).default;
    return await run(prisma);
  },
}));

vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: requireProjectAccessMock,
  requireProjectAccessForUser: requireProjectAccessMock,
}));

vi.mock("@/lib/image-studio/fal-client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/image-studio/fal-client")>(
    "@/lib/image-studio/fal-client",
  )),
  submitToQueue: submitToQueueMock,
  uploadReference: uploadReferenceMock,
}));

vi.mock("@/services/image-studio-assets.service", () => ({
  readAssetBytes: readAssetBytesMock,
}));

import {
  IMAGE_MODEL_EDIT,
  IMAGE_MODEL_GENERATE,
} from "@/lib/image-studio/fal-client";
import {
  createImageJob,
  readPngDimensions,
  sweepStalledSubmissions,
} from "@/services/image-studio-jobs.service";

const BASE_INPUT = {
  projectId: "project-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  sessionId: null,
  prompt: "a calm product shot",
  settings: {
    aspectRatio: "1:1",
    resolution: "1K",
    outputFormat: "png",
    seed: null,
  },
  referenceAssetIds: [] as string[],
  parentAssetId: null,
  idempotencyKey: "key-abcdefgh",
};

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    projectId: "project-1",
    workspaceId: "workspace-1",
    model: IMAGE_MODEL_GENERATE,
    kind: "GENERATE",
    prompt: BASE_INPUT.prompt,
    settings: BASE_INPUT.settings,
    referenceAssetIds: [],
    parentAssetId: null,
    status: "PENDING",
    submitAttempts: 0,
    createdAt: new Date(),
    submittedAt: null,
    settledAt: null,
    error: null,
    ...overrides,
  };
}

describe("image studio job submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      FAL_KEY: "k",
      BLOB_READ_WRITE_TOKEN: "shared-public-store-token",
      IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN: "studio-private-store-token",
    });
    requireProjectAccessMock.mockResolvedValue({
      projectId: "project-1",
      workspaceId: "workspace-1",
      userId: "user-1",
    });
    jobCountMock.mockResolvedValue(0);
    jobFindUniqueMock.mockResolvedValue(null);
    jobCreateMock.mockImplementation(async () => jobRow());
    jobFindUniqueOrThrowMock.mockImplementation(async () => jobRow());
    jobUpdateMock.mockImplementation(async ({ data }) =>
      jobRow({ ...data, status: data.status ?? "PENDING" }),
    );
    // One caller wins the lease.
    jobUpdateManyMock.mockResolvedValue({ count: 1 });
  });

  it("classifies a definite provider refusal as failed and therefore retryable", async () => {
    submitToQueueMock.mockResolvedValue({
      kind: "rejected",
      status: 422,
      message: "prompt rejected",
    });

    const job = await createImageJob(BASE_INPUT);

    expect(job.status).toBe("FAILED");
    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });

  it("classifies a lost answer as uncertain, never as failed", async () => {
    submitToQueueMock.mockResolvedValue({
      kind: "uncertain",
      message: "The operation timed out",
    });

    const job = await createImageJob(BASE_INPUT);

    // The distinction is the whole point: a retry here could be a second
    // charge, so it must not look like an ordinary failure.
    expect(job.status).toBe("SUBMISSION_UNCERTAIN");
    const written = jobUpdateMock.mock.calls[0]![0].data;
    expect(written.status).toBe("SUBMISSION_UNCERTAIN");
    // Not settled: the row stays in the hourly spend window, because it may
    // represent money.
    expect(written).not.toHaveProperty("settledAt");
  });

  it("returns the existing job for a replayed idempotency key without calling fal", async () => {
    jobFindUniqueMock.mockResolvedValue(jobRow({ status: "QUEUED" }));

    const job = await createImageJob(BASE_INPUT);

    expect(job.status).toBe("QUEUED");
    expect(jobCreateMock).not.toHaveBeenCalled();
    expect(submitToQueueMock).not.toHaveBeenCalled();
  });

  it("does not reach fal when another caller already holds the submission lease", async () => {
    // The conditional update matched nothing: someone else moved the row out
    // of PENDING first.
    jobUpdateManyMock.mockResolvedValue({ count: 0 });
    jobFindUniqueMock
      .mockResolvedValueOnce(null) // the idempotency lookup
      .mockResolvedValueOnce(jobRow({ status: "SUBMITTING" }));

    const job = await createImageJob(BASE_INPUT);

    expect(submitToQueueMock).not.toHaveBeenCalled();
    expect(job.status).toBe("SUBMITTING");
  });

  it("refuses to generate before spending anything when there is no private store", async () => {
    // Checked ahead of the reservation and the provider call, because the
    // alternative is paying fal for an image the studio is not allowed to
    // keep — which is exactly what happened when settlement was the only place
    // storage was checked. The shared public token is still set here: it is
    // not an acceptable substitute and must not be treated as one.
    getEnvMock.mockReturnValue({
      FAL_KEY: "k",
      BLOB_READ_WRITE_TOKEN: "shared-public-store-token",
    });

    const refusal = await createImageJob(BASE_INPUT).catch(
      (error: unknown) => error,
    );
    expect(refusal).toMatchObject({ status: 503 });
    // Says what happened, not how the deployment is configured: an env var
    // name is useless to the reader and useful to a prober.
    expect(String((refusal as Error).message)).not.toContain(
      "IMAGE_STUDIO_BLOB",
    );
    expect(jobCreateMock).not.toHaveBeenCalled();
    expect(submitToQueueMock).not.toHaveBeenCalled();
  });

  it("refuses a new generation past the per-project concurrency limit", async () => {
    jobCountMock.mockResolvedValue(3);

    await expect(createImageJob(BASE_INPUT)).rejects.toMatchObject({
      status: 429,
    });
    expect(jobCreateMock).not.toHaveBeenCalled();
    expect(submitToQueueMock).not.toHaveBeenCalled();
  });

  it("refuses past the per-user hourly limit", async () => {
    jobCountMock
      .mockResolvedValueOnce(0) // project in-flight
      .mockResolvedValueOnce(40); // user this hour

    await expect(createImageJob(BASE_INPUT)).rejects.toMatchObject({
      status: 429,
    });
    expect(submitToQueueMock).not.toHaveBeenCalled();
  });

  it("routes a refinement to the edit endpoint with the reference attached", async () => {
    jobCreateMock.mockImplementation(async ({ data }) =>
      jobRow({
        kind: data.kind,
        model: data.model,
        referenceAssetIds: data.referenceAssetIds,
        parentAssetId: data.parentAssetId,
      }),
    );
    jobFindUniqueOrThrowMock.mockResolvedValue(
      jobRow({
        kind: "EDIT",
        model: IMAGE_MODEL_EDIT,
        referenceAssetIds: ["asset-1"],
        parentAssetId: "asset-1",
      }),
    );
    assetFindManyMock.mockResolvedValue([
      {
        id: "asset-1",
        blobPathname: "p",
        contentType: "image/png",
        bytes: 1000,
      },
    ]);
    readAssetBytesMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    uploadReferenceMock.mockResolvedValue("https://v3b.fal.media/files/x.png");
    submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-1" });

    await createImageJob({
      ...BASE_INPUT,
      referenceAssetIds: ["asset-1"],
      parentAssetId: "asset-1",
    });

    expect(jobCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "EDIT",
          model: IMAGE_MODEL_EDIT,
        }),
      }),
    );
    // The base endpoint silently ignores `image_urls`, so a refinement sent
    // there would quietly become an unrelated fresh image.
    expect(submitToQueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: IMAGE_MODEL_EDIT,
        input: expect.objectContaining({
          image_urls: ["https://v3b.fal.media/files/x.png"],
        }),
      }),
    );
  });

  it("sends reference bytes to the provider's storage, not one of our URLs", async () => {
    jobFindUniqueOrThrowMock.mockResolvedValue(
      jobRow({
        kind: "EDIT",
        model: IMAGE_MODEL_EDIT,
        referenceAssetIds: ["asset-1"],
      }),
    );
    assetFindManyMock.mockResolvedValue([
      {
        id: "asset-1",
        blobPathname: "projects/p/image-studio/secret",
        contentType: "image/png",
        bytes: 10,
      },
    ]);
    readAssetBytesMock.mockResolvedValue(new Uint8Array([9]));
    uploadReferenceMock.mockResolvedValue("https://v3b.fal.media/files/y.png");
    submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-2" });

    await createImageJob({ ...BASE_INPUT, referenceAssetIds: ["asset-1"] });

    expect(uploadReferenceMock).toHaveBeenCalledOnce();
    const submitted = submitToQueueMock.mock.calls[0]![0];
    expect(JSON.stringify(submitted)).not.toContain("blob.vercel-storage.com");
    expect(JSON.stringify(submitted)).not.toContain("image-studio/secret");
  });

  it("returns the winning row when two callers race the same key into the index", async () => {
    // Both passed the existence check; Postgres caught the loser. The answer
    // the caller wants is the row that won, not a 500.
    jobFindUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(jobRow({ status: "QUEUED" }));
    jobCreateMock.mockRejectedValue(
      Object.assign(new Error("unique"), { code: "P2002" }),
    );

    const job = await createImageJob(BASE_INPUT);

    expect(job.status).toBe("QUEUED");
    expect(submitToQueueMock).not.toHaveBeenCalled();
  });

  it("does not submit when the same key is replayed while the first attempt is uncertain", async () => {
    jobFindUniqueMock.mockResolvedValue(
      jobRow({ status: "SUBMISSION_UNCERTAIN", submitAttempts: 1 }),
    );

    const job = await createImageJob(BASE_INPUT);

    expect(job.status).toBe("SUBMISSION_UNCERTAIN");
    expect(submitToQueueMock).not.toHaveBeenCalled();
  });
});

describe("stalled submission sweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobUpdateManyMock.mockResolvedValue({ count: 2 });
  });

  it("resolves an abandoned lease to uncertain and never back to pending", async () => {
    const swept = await sweepStalledSubmissions(
      new Date("2026-09-25T12:00:00.000Z"),
    );

    expect(swept).toBe(2);
    const call = jobUpdateManyMock.mock.calls[0]![0];
    expect(call.where.status).toBe("SUBMITTING");
    expect(call.data.status).toBe("SUBMISSION_UNCERTAIN");
    // A crash between the lease and the provider's answer must never become a
    // resubmittable row: that is the duplicate charge.
    expect(call.data.status).not.toBe("PENDING");
  });
});

describe("readPngDimensions", () => {
  it("reads width and height from a PNG header", () => {
    const bytes = new Uint8Array(24);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    new DataView(bytes.buffer).setUint32(16, 1024);
    new DataView(bytes.buffer).setUint32(20, 768);
    expect(readPngDimensions(bytes)).toEqual({ width: 1024, height: 768 });
  });

  it("returns null for anything that is not a PNG", () => {
    expect(readPngDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
