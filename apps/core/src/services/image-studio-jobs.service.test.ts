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
  createTaskEventTransactionMock,
  jobAggregateMock,
  getBalanceMock,
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
  createTaskEventTransactionMock: vi.fn(),
  jobAggregateMock: vi.fn(),
  getBalanceMock: vi.fn(),
}));

// The submit-time balance check: read-only, and not what this suite is about.
// Money is covered end to end in `image-studio-credits.test.ts`.
vi.mock("@/services/image-studio-files.service", () => ({
  publishImageToFiles: vi.fn(),
}));
vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: { getBalance: getBalanceMock },
}));

vi.mock("@/helpers/task-credits", () => ({
  createTaskEventTransaction: createTaskEventTransactionMock,
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
  getBetterAuthPublicBaseUrl: () => "http://localhost:3001",
}));

vi.mock("@/lib/db/prisma", () => {
  const client = {
    projectImageJob: {
      aggregate: jobAggregateMock,
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
    transaction: { create: vi.fn() },
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

import { imageModel } from "@/lib/image-studio/catalog";
import {
  createImageJob,
  readProviderSize,
  sweepStalledSubmissions,
} from "@/services/image-studio-jobs.service";

/**
 * The default model's endpoints, taken from the catalog rather than written out.
 *
 * The studio has a hundred and fifty models now, so a literal here would be a
 * second opinion about which one is the default.
 */
const DEFAULT_IMAGE_ENDPOINT_GENERATE = imageModel().generateEndpoint;
const DEFAULT_IMAGE_ENDPOINT_EDIT = imageModel().editEndpoint!;

// Credits are covered end to end in `image-studio-credits.test.ts`; this suite is
// about submission, and only stubs the debit so reservation can get past it.

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
    model: DEFAULT_IMAGE_ENDPOINT_GENERATE,
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
      organizationId: null,
    });
    createTaskEventTransactionMock.mockResolvedValue("txn-debit-1");
    jobAggregateMock.mockResolvedValue({ _sum: { chargedCents: null } });
    // Plenty, so nothing here is refused for money.
    getBalanceMock.mockResolvedValue(10_000_000_000_000n);
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

  it("persists the chosen model before submitting the model-specific payload", async () => {
    const stored = jobRow({
      model: "fal-ai/flux-2-pro",
      settings: { ...BASE_INPUT.settings, aspectRatio: "2:3" },
    });
    jobCreateMock.mockResolvedValue(stored);
    jobFindUniqueOrThrowMock.mockResolvedValue(stored);
    submitToQueueMock.mockResolvedValue({
      kind: "queued",
      requestId: "fal-123",
    });
    await createImageJob({
      ...BASE_INPUT,
      modelId: "flux-2-pro",
      settings: { ...BASE_INPUT.settings, aspectRatio: "2:3" },
    });
    expect(jobCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          model: "fal-ai/flux-2-pro",
          settings: expect.objectContaining({ aspectRatio: "2:3" }),
        }),
      }),
    );
    expect(submitToQueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "fal-ai/flux-2-pro",
        input: expect.objectContaining({
          image_size: { width: 672, height: 1024 },
        }),
      }),
    );
    expect(submitToQueueMock.mock.calls[0][0].input).not.toHaveProperty(
      "resolution",
    );
  });

  it("sends only the provider fields the chosen endpoint declares", async () => {
    // `num_images` and `limit_generations` are Gemini's fields. Sending them to
    // a model that never declared them is a 422 on a generation that would
    // otherwise have worked.
    const stored = jobRow({ model: "fal-ai/flux-2-pro" });
    jobCreateMock.mockResolvedValue(stored);
    jobFindUniqueOrThrowMock.mockResolvedValue(stored);
    submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-1" });
    await createImageJob({ ...BASE_INPUT, modelId: "flux-2-pro" });
    const input = submitToQueueMock.mock.calls[0]![0].input;
    expect(input).not.toHaveProperty("num_images");
    expect(input).not.toHaveProperty("limit_generations");
    expect(input).not.toHaveProperty("aspect_ratio");
    expect(input).toHaveProperty("image_size");
  });

  it.each([
    { modelId: "unverified-model" },
    {
      modelId: "flux-2-pro",
      settings: { ...BASE_INPUT.settings, outputFormat: "webp" },
    },
    {
      modelId: "gemini-pro",
      settings: { ...BASE_INPUT.settings, resolution: "0.5K" },
    },
  ])(
    "rejects incompatible model settings before reserving or spending",
    async (invalid) => {
      await expect(
        createImageJob({ ...BASE_INPUT, ...invalid }),
      ).rejects.toMatchObject({ status: 422 });
      expect(jobCreateMock).not.toHaveBeenCalled();
      expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
      expect(submitToQueueMock).not.toHaveBeenCalled();
      expect(uploadReferenceMock).not.toHaveBeenCalled();
    },
  );

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
        model: DEFAULT_IMAGE_ENDPOINT_EDIT,
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
          model: DEFAULT_IMAGE_ENDPOINT_EDIT,
        }),
      }),
    );
    // The base endpoint silently ignores `image_urls`, so a refinement sent
    // there would quietly become an unrelated fresh image.
    expect(submitToQueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: DEFAULT_IMAGE_ENDPOINT_EDIT,
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
        model: DEFAULT_IMAGE_ENDPOINT_EDIT,
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

describe("readProviderSize", () => {
  it("takes the provider's figures when it reports them", () => {
    expect(readProviderSize({ width: 1344, height: 768 })).toEqual({
      width: 1344,
      height: 768,
    });
  });

  it("refuses a size the provider did not really give", () => {
    // fal sends nulls for endpoints that report nothing, and the shape allows
    // anything. A half-reported size must not be stored as `1024x0`.
    expect(readProviderSize(undefined)).toBeNull();
    expect(readProviderSize({ width: null, height: null })).toBeNull();
    expect(readProviderSize({ width: 1024, height: null })).toBeNull();
    expect(readProviderSize({ width: 0, height: 0 })).toBeNull();
    expect(readProviderSize({ width: -1, height: 10 })).toBeNull();
    expect(readProviderSize({ width: 10.5, height: 10 })).toBeNull();
  });
});
