import { createHash } from "node:crypto";

import { FileSourceKind, Prisma } from "@sokosumi/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  assetFindFirstMock,
  getEnvMock,
  submitToQueueMock,
  uploadReferenceMock,
  readAssetBytesMock,
  requireProjectAccessMock,
  createTaskEventTransactionMock,
  jobAggregateMock,
  getBalanceMock,
  projectFindUniqueMock,
  ssrfSafeFetchMock,
  driveHeadMock,
  driveReadUrlMock,
  loadLiveResourcesMock,
  snapshotUpsertMock,
  waitUntilMock,
  adEventCreateMock,
  readReferenceImageMock,
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
  assetFindFirstMock: vi.fn(),
  getEnvMock: vi.fn(),
  submitToQueueMock: vi.fn(),
  uploadReferenceMock: vi.fn(),
  readAssetBytesMock: vi.fn(),
  requireProjectAccessMock: vi.fn(),
  createTaskEventTransactionMock: vi.fn(),
  jobAggregateMock: vi.fn(),
  getBalanceMock: vi.fn(),
  projectFindUniqueMock: vi.fn(),
  ssrfSafeFetchMock: vi.fn(),
  driveHeadMock: vi.fn(),
  driveReadUrlMock: vi.fn(),
  loadLiveResourcesMock: vi.fn(),
  snapshotUpsertMock: vi.fn(),
  waitUntilMock: vi.fn(),
  adEventCreateMock: vi.fn(),
  readReferenceImageMock: vi.fn(async () => null),
}));
const { isEvalWorkspaceMock, fetchQueueStatusMock } = vi.hoisted(() => ({
  isEvalWorkspaceMock: vi.fn(async () => false),
  fetchQueueStatusMock: vi.fn(),
}));
const observation = vi.hoisted(() => ({ reserving: false }));

vi.mock("@vercel/functions", () => ({ waitUntil: waitUntilMock }));
vi.mock("@/lib/evals/eval-guard", () => ({
  isEvalWorkspace: isEvalWorkspaceMock,
}));

vi.mock("@/lib/drive-blob", () => ({
  driveHead: driveHeadMock,
  driveReadUrl: driveReadUrlMock,
}));

// The submit-time balance check: read-only, and not what this suite is about.
// Money is covered end to end in `image-studio-credits.test.ts`.
vi.mock("@/services/image-studio-drive.service", () => ({
  publishStudioAssetToFiles: vi.fn(),
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
      findFirst: assetFindFirstMock,
      create: vi.fn(),
    },
    project: { findUnique: projectFindUniqueMock },
    projectImagePromptSnapshot: { upsert: snapshotUpsertMock },
    adEvent: { create: adEventCreateMock },
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
    observation.reserving = true;
    try {
      return await run(prisma);
    } finally {
      observation.reserving = false;
    }
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
  fetchQueueStatus: fetchQueueStatusMock,
  uploadReference: uploadReferenceMock,
}));

vi.mock("@/services/file-search.service", () => ({
  loadLiveResources: loadLiveResourcesMock,
}));

vi.mock("@/services/image-studio-assets.service", () => ({
  readAssetBytes: readAssetBytesMock,
}));
vi.mock("@/services/reference-library.service", () => ({
  readReferenceImage: readReferenceImageMock,
}));

vi.mock("@sokosumi/net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/net")>()),
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

import type {
  createNetworkScope,
  MainnetScope,
  NetworkScope,
} from "@/lib/db/network-scope";
import { imageModel } from "@/lib/image-studio/catalog";
import { STUDIO_PROMPT_ASSEMBLY_VERSION } from "@/lib/image-studio/studio-brand";
import {
  createImageJob,
  failImageJob,
  readProviderSize,
  reconcileJob,
  reconcileProjectJobs,
  reconcileStaleJobs,
  reconcileWorkspaceJobs,
  recoverUnclaimedReservations,
  requestCancel,
  settleWithMedia,
  sweepStalledSubmissions,
} from "@/services/image-studio-jobs.service";
import { coreLogEvents, expectCoreLogWhys } from "@/test/core-log";

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
    requestedByUserId: BASE_INPUT.userId,
    idempotencyKey: BASE_INPUT.idempotencyKey,
    model: DEFAULT_IMAGE_ENDPOINT_GENERATE,
    kind: "GENERATE",
    prompt: BASE_INPUT.prompt,
    settings: BASE_INPUT.settings,
    referenceAssetIds: [],
    referenceFileIds: [],
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
    snapshotUpsertMock.mockReset().mockResolvedValue({});
    adEventCreateMock.mockReset().mockResolvedValue({});
    projectFindUniqueMock.mockResolvedValue({
      designMdUrl: null,
      contextMd: null,
    });
  });

  describe("in a benchmark lane", () => {
    beforeEach(() => {
      isEvalWorkspaceMock.mockResolvedValue(true);
      submitToQueueMock.mockRejectedValue(
        new Error("a benchmark lane must never reach fal"),
      );
      fetchQueueStatusMock.mockRejectedValue(
        new Error("a benchmark lane must never ask fal"),
      );
    });
    afterEach(() => {
      isEvalWorkspaceMock.mockResolvedValue(false);
      submitToQueueMock.mockReset();
      fetchQueueStatusMock.mockReset();
    });

    it("queues an image job on the stub, never on fal", async () => {
      await createImageJob(BASE_INPUT);
      expect(submitToQueueMock).not.toHaveBeenCalled();
      expect(jobUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "QUEUED",
            falRequestId: expect.stringMatching(/^eval-stub:/),
          }),
        }),
      );
    });

    it("does not hold stub images to the owner's hourly spend cap", async () => {
      // In flight: 0. Started this hour: far past the cap.
      jobCountMock.mockImplementation(
        async (args: { where: { createdAt?: unknown } }) =>
          args.where.createdAt ? 10_000 : 0,
      );
      await expect(createImageJob(BASE_INPUT)).resolves.toBeDefined();
      jobCountMock.mockResolvedValue(0);
    });

    it("fails a talking video closed: unsent, uncharged, no provider call", async () => {
      expectCoreLogWhys(
        "warn",
        "An image generation failed before it was sent",
        ["Preparing the request for the image provider threw"],
      );
      jobFindUniqueOrThrowMock.mockImplementation(async () =>
        jobRow({ kind: "TALKING_VIDEO" }),
      );
      await createImageJob(BASE_INPUT);
      expect(submitToQueueMock).not.toHaveBeenCalled();
      expect(jobUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "FAILED",
            failureReason: "request_not_supported",
          }),
        }),
      );
    });

    it("settles a stub job without asking fal", async () => {
      jobFindUniqueMock.mockResolvedValue(
        jobRow({ status: "QUEUED", falRequestId: "eval-stub:job-1" }),
      );
      await reconcileJob({ network: "mainnet" } as MainnetScope, "job-1");
      expect(fetchQueueStatusMock).not.toHaveBeenCalled();
    });
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

  it("takes the edit endpoint for a job whose only reference is a library style", async () => {
    // The generate endpoint refuses the style reference it is then sent.
    // This row has no library store to read from, so sending stops early.
    expectCoreLogWhys("warn", "An image generation failed before it was sent", [
      "Preparing the request for the image provider threw",
    ]);
    const stored = jobRow({ model: "google/nano-banana-2.1/edit" });
    jobCreateMock.mockResolvedValue(stored);
    jobFindUniqueOrThrowMock.mockResolvedValue(stored);
    await createImageJob({
      ...BASE_INPUT,
      modelId: "nano-banana-2-1",
      referenceLibraryIds: ["0199c1f0-0000-7000-8000-000000000001"],
    });
    expect(jobCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "EDIT",
          model: "google/nano-banana-2.1/edit",
        }),
      }),
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
    const refusals = expectCoreLogWhys(
      "warn",
      "The image provider refused a generation",
      ["fal answered the submission with a rejection"],
    );
    submitToQueueMock.mockResolvedValue({
      kind: "rejected",
      status: 422,
      message: "prompt rejected: SECRET-PROMPT-SENTINEL",
    });

    const job = await createImageJob(BASE_INPUT);

    // The provider's message can quote the prompt: only its status is logged.
    expect(refusals[0]?.event).toMatchObject({
      imageJobs: [{ id: "job-1", provider: { name: "fal", status: 422 } }],
    });
    expect(JSON.stringify(coreLogEvents())).not.toContain(
      "SECRET-PROMPT-SENTINEL",
    );

    expect(job.status).toBe("FAILED");
    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });

  it("classifies a lost answer as uncertain, never as failed", async () => {
    expectCoreLogWhys(
      "warn",
      "Could not tell whether the image provider received a generation",
      ["The submission to fal ended without a clear answer"],
    );
    submitToQueueMock.mockResolvedValue({
      kind: "uncertain",
      message: "The operation timed out: SECRET-PROMPT-SENTINEL",
    });

    const job = await createImageJob(BASE_INPUT);
    expect(JSON.stringify(coreLogEvents())).not.toContain(
      "SECRET-PROMPT-SENTINEL",
    );

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
    jobFindUniqueMock.mockResolvedValue(
      jobRow({
        status: "QUEUED",
        parentAssetId: "asset-1",
        batchSlotId: "slot-1",
      }),
    );

    const job = await createImageJob(BASE_INPUT);

    expect(job.status).toBe("QUEUED");
    expect(jobCreateMock).not.toHaveBeenCalled();
    expect(submitToQueueMock).not.toHaveBeenCalled();
    expect(snapshotUpsertMock).not.toHaveBeenCalled();
    expect(adEventCreateMock).not.toHaveBeenCalled();
  });

  it("records the refinement without replacing a batch slot before delivery", async () => {
    jobCreateMock.mockResolvedValue(
      jobRow({ parentAssetId: "asset-1", batchSlotId: "slot-1" }),
    );
    adEventCreateMock.mockRejectedValue(new Error("event store unavailable"));
    submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-1" });

    await expect(createImageJob(BASE_INPUT)).resolves.toMatchObject({
      status: "QUEUED",
    });

    expect(adEventCreateMock).toHaveBeenNthCalledWith(1, {
      data: {
        workspaceId: BASE_INPUT.workspaceId,
        assetId: "asset-1",
        userId: BASE_INPUT.userId,
        type: "refined",
        meta: { jobId: "job-1" },
      },
    });
    expect(adEventCreateMock).toHaveBeenCalledTimes(1);
  });

  it("persists the selected product and batch independently of provider settings", async () => {
    jobUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    await createImageJob({
      ...BASE_INPUT,
      product: { id: "product-a", name: "Clay mug" },
      batchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    expect(jobCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: "product-a",
        productName: "Clay mug",
        batchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        settings: BASE_INPUT.settings,
      }),
    });
    expect(assetFindFirstMock).not.toHaveBeenCalled();
  });

  it("inherits the product without copying prompt context from a parent image", async () => {
    assetFindFirstMock.mockResolvedValueOnce({
      job: {
        productId: "product-a",
        productName: "Clay mug",
        templateId: "social-post",
        creativeDirection: "lifestyle",
        variationIndex: 2,
      },
    });
    jobUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    await createImageJob({ ...BASE_INPUT, parentAssetId: "parent-a" });

    expect(assetFindFirstMock).toHaveBeenCalledWith({
      where: { id: "parent-a", projectId: BASE_INPUT.projectId },
      select: {
        job: {
          select: {
            productId: true,
            productName: true,
            referenceFileIds: true,
          },
        },
      },
    });
    expect(jobCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: "product-a",
        productName: "Clay mug",
      }),
    });
    const data = jobCreateMock.mock.lastCall?.[0]?.data;
    expect(data).not.toHaveProperty("templateId");
    expect(data).not.toHaveProperty("creativeDirection");
    expect(data).not.toHaveProperty("variationIndex");
  });

  const photoInput = {
    ...BASE_INPUT,
    modelId: "flux-2-pro",
    referenceFileIds: ["file-1"],
    referenceFileActor: {
      userId: BASE_INPUT.userId,
      organizationId: null,
      kind: "interactive",
    },
  } satisfies Parameters<typeof createImageJob>[0];

  it.each([
    { visible: true, references: ["parent-a"], expected: ["file-1"] },
    { visible: false, references: ["parent-a"], expected: [] },
    {
      visible: true,
      references: ["parent-a", "other-a", "other-b", "other-c"],
      expected: [],
    },
  ])(
    "reuses an accessible original photo only if the edit has room ($visible, $references)",
    async ({ visible, references, expected }) => {
      jobUpdateManyMock.mockResolvedValueOnce({ count: 0 });
      assetFindFirstMock.mockResolvedValueOnce({
        job: {
          productId: "product-a",
          productName: "Clay mug",
          referenceFileIds: ["file-1"],
        },
      });
      if (references.length === 1) {
        loadLiveResourcesMock.mockResolvedValueOnce(
          visible
            ? [
                {
                  id: "file-1",
                  sourceKind: FileSourceKind.DRIVE_UPLOAD,
                  mimeType: "image/jpeg",
                  sizeBytes: 2,
                },
              ]
            : [],
        );
      }

      await createImageJob({
        ...photoInput,
        referenceFileIds: undefined,
        parentAssetId: "parent-a",
        referenceAssetIds: references,
        reuseParentPhotoIfAvailable: true,
      });

      expect(jobCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          referenceAssetIds: references,
          referenceFileIds: expected,
        }),
      });
      if (references.length === 1) {
        expect(loadLiveResourcesMock).toHaveBeenCalledWith(
          {
            workspaceId: BASE_INPUT.workspaceId,
            actor: photoInput.referenceFileActor,
            resourceIds: ["file-1"],
          },
          expect.any(Object),
        );
      } else {
        expect(loadLiveResourcesMock).not.toHaveBeenCalled();
      }
    },
  );

  it("refuses a new photo request when the file is not visible to the caller", async () => {
    loadLiveResourcesMock.mockResolvedValueOnce([]);

    await expect(createImageJob(photoInput)).rejects.toMatchObject({
      status: 404,
    });
    expect(loadLiveResourcesMock).toHaveBeenCalledWith(
      {
        workspaceId: BASE_INPUT.workspaceId,
        actor: photoInput.referenceFileActor,
        resourceIds: ["file-1"],
      },
      expect.any(Object),
    );
    expect(jobCreateMock).not.toHaveBeenCalled();
    expect(submitToQueueMock).not.toHaveBeenCalled();
  });

  it("applies the Studio reference cap before buying a job", async () => {
    await expect(
      createImageJob({
        ...photoInput,
        modelId: "muse-image",
        referenceAssetIds: ["asset-1", "asset-2", "asset-3", "asset-4"],
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(loadLiveResourcesMock).not.toHaveBeenCalled();
    expect(jobCreateMock).not.toHaveBeenCalled();
    expect(submitToQueueMock).not.toHaveBeenCalled();
  });

  it.each([
    { idempotencyKey: "key-abcdefgh", kind: "interactive" },
    { idempotencyKey: "soko-bot:turn-id:tool-call-id", kind: "soko_bot" },
    { idempotencyKey: "cmo-media:version-id:piece-id", kind: "soko_bot" },
  ])(
    "blocks a recovered job without photo access ($idempotencyKey)",
    async ({ idempotencyKey, kind }) => {
      expectCoreLogWhys(
        "warn",
        "An image generation failed before it was sent",
        ["Preparing the request for the image provider threw"],
      );
      const now = new Date("2026-11-10T12:00:00Z");
      const pending = jobRow({
        createdAt: new Date("2026-11-10T11:58:00Z"),
        idempotencyKey,
        kind: "EDIT",
        model: DEFAULT_IMAGE_ENDPOINT_EDIT,
        referenceFileIds: ["file-1"],
      });
      requireProjectAccessMock.mockResolvedValueOnce({
        projectId: BASE_INPUT.projectId,
        workspaceId: BASE_INPUT.workspaceId,
        userId: BASE_INPUT.userId,
        organizationId: "organization-1",
      });
      jobFindManyMock.mockResolvedValueOnce([pending]);
      jobFindUniqueOrThrowMock.mockResolvedValueOnce(pending);
      loadLiveResourcesMock.mockResolvedValueOnce([]);

      await recoverUnclaimedReservations({ now });

      expect(loadLiveResourcesMock).toHaveBeenCalledWith(
        {
          workspaceId: BASE_INPUT.workspaceId,
          actor: {
            kind,
            userId: BASE_INPUT.userId,
            organizationId: "organization-1",
          },
          resourceIds: ["file-1"],
        },
        expect.any(Object),
      );
      expect(driveHeadMock).not.toHaveBeenCalled();
      expect(uploadReferenceMock).not.toHaveBeenCalled();
      expect(submitToQueueMock).not.toHaveBeenCalled();
      expect(jobUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "FAILED",
            failureReason: "reference_not_sendable",
          }),
        }),
      );
    },
  );

  it("returns a photo job on replay after the reference is removed", async () => {
    jobFindUniqueMock.mockResolvedValue(
      jobRow({ status: "QUEUED", referenceFileIds: ["file-1"] }),
    );

    await expect(createImageJob(photoInput)).resolves.toMatchObject({
      status: "QUEUED",
      referenceFileIds: ["file-1"],
    });
    expect(loadLiveResourcesMock).not.toHaveBeenCalled();
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
    expectCoreLogWhys(
      "error",
      "Refused an image studio request, because its private storage is not configured",
      [
        "IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN is unset, and the studio never falls back to the shared public store named by BLOB_READ_WRITE_TOKEN",
      ],
    );
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

  it("checks the eval registry before the reservation, never with a second client inside it", async () => {
    const inside: boolean[] = [];
    isEvalWorkspaceMock.mockImplementationOnce(async () => {
      inside.push(observation.reserving);
      return false;
    });
    jobCountMock.mockResolvedValueOnce(0).mockResolvedValueOnce(40);
    await expect(createImageJob(BASE_INPUT)).rejects.toMatchObject({
      status: 429,
    });
    expect(inside).toEqual([false]);
  });

  it("leaves the month's own pictures and other video shapes out of the owner's hourly count", async () => {
    // cmo-post-with-picture on mainnet, 2026-11-25: a month's 46 pictures
    // used the owner's 40 an hour, and the picture asked for in chat failed.
    await createImageJob(BASE_INPUT);
    expect(jobCountMock).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        requestedByUserId: "user-1",
        NOT: [
          { idempotencyKey: { startsWith: "cmo-media:" } },
          { idempotencyKey: { startsWith: "video-shape:" } },
        ],
      }),
    });
  });

  it("leaves other video shapes out of the project's slots: they ask no provider", async () => {
    await createImageJob(BASE_INPUT);
    expect(jobCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        projectId: "project-1",
        NOT: { idempotencyKey: { startsWith: "video-shape:" } },
      }),
    });
  });

  it("gives Core's month media twelve at a time and no hourly cap", async () => {
    // The approved plan bounds a month; NMKR's 34 pictures in 37 minutes
    // ran into a person's 40 an hour.
    jobCountMock.mockResolvedValue(11);
    await createImageJob({ ...BASE_INPUT, forCmoMonth: true });
    expect(jobCreateMock).toHaveBeenCalledTimes(1);
    // Only the project's jobs in flight are counted, never the hour's.
    expect(jobCountMock).toHaveBeenCalledTimes(1);

    jobCreateMock.mockClear();
    jobCountMock.mockResolvedValue(12);
    await expect(
      createImageJob({ ...BASE_INPUT, forCmoMonth: true }),
    ).rejects.toMatchObject({ status: 429 });
    expect(jobCreateMock).not.toHaveBeenCalled();
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
    expect(adEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ assetId: "asset-1", type: "refined" }),
    });
    expect(adEventCreateMock).toHaveBeenCalledTimes(1);
  });

  it("tries a reference File once more when its download fails", async () => {
    jobCreateMock.mockImplementation(async ({ data }) =>
      jobRow({
        kind: data.kind,
        model: data.model,
        referenceFileIds: data.referenceFileIds,
      }),
    );
    jobFindUniqueOrThrowMock.mockResolvedValue(
      jobRow({
        kind: "EDIT",
        model: DEFAULT_IMAGE_ENDPOINT_EDIT,
        referenceFileIds: ["file-1"],
      }),
    );
    loadLiveResourcesMock.mockResolvedValueOnce([
      {
        id: "file-1",
        sourceKind: "DRIVE_UPLOAD",
        sourceId: "drive/w/dashboard.jpg",
        mimeType: "image/jpeg",
      },
    ]);
    driveHeadMock.mockResolvedValue({
      access: "public",
      url: "https://store.public.blob.vercel-storage.com/drive/w/dashboard.jpg",
      size: 1,
    });
    // Our own blob store, read without the SSRF guard its bot check refuses.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1]), {
          headers: { "content-type": "image/jpeg" },
        }),
      );
    uploadReferenceMock.mockResolvedValue("https://v3b.fal.media/files/d.jpg");
    submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-4" });

    await createImageJob({ ...BASE_INPUT, referenceFileIds: ["file-1"] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
    expect(submitToQueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          image_urls: ["https://v3b.fal.media/files/d.jpg"],
        }),
      }),
    );
  });

  it.each([
    {
      brandReferenceCount: 0,
      guidance:
        "Use the last reference image for the advertised product's appearance. Keep its shape, colors, materials, packaging, and any legible label text",
    },
    {
      brandReferenceCount: 1,
      guidance: "Use the supplied brand images as visual references",
    },
  ])(
    "sends the uploaded reference after the source ad with the correct role ($brandReferenceCount brand images)",
    async ({ brandReferenceCount, guidance }) => {
      jobCreateMock.mockImplementation(async ({ data }) =>
        jobRow({
          kind: data.kind,
          model: data.model,
          referenceAssetIds: data.referenceAssetIds,
          referenceFileIds: data.referenceFileIds,
        }),
      );
      jobFindUniqueOrThrowMock.mockResolvedValue(
        jobRow({
          kind: "EDIT",
          brandReferenceCount,
          model: DEFAULT_IMAGE_ENDPOINT_EDIT,
          referenceAssetIds: ["asset-1"],
          referenceFileIds: ["file-1"],
        }),
      );
      assetFindManyMock.mockResolvedValueOnce([
        {
          id: "asset-1",
          blobPathname: "private/source.png",
          bytes: 2,
          contentType: "image/png",
        },
      ]);
      readAssetBytesMock.mockResolvedValueOnce(new Uint8Array([3, 4]));
      loadLiveResourcesMock.mockResolvedValueOnce([
        {
          id: "file-1",
          sourceKind: "DRIVE_UPLOAD",
          sourceId: "drive/w/leggings.jpg",
          mimeType: "image/jpeg",
        },
      ]);
      driveHeadMock.mockResolvedValue({
        access: "private",
        url: "https://store.private.blob.vercel-storage.com/drive/w/leggings.jpg",
        size: 2,
      });
      const signedUrl = "https://store.private.blob.vercel-storage.com/signed";
      driveReadUrlMock.mockResolvedValue(signedUrl);
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(new Uint8Array([1, 2]), {
          headers: { "content-type": "image/jpeg" },
        }),
      );
      uploadReferenceMock
        .mockResolvedValueOnce("https://v3b.fal.media/files/source.png")
        .mockResolvedValueOnce("https://v3b.fal.media/files/l.jpg");
      submitToQueueMock.mockResolvedValue({
        kind: "queued",
        requestId: "fal-3",
      });

      await createImageJob({
        ...BASE_INPUT,
        brandReferenceCount,
        referenceAssetIds: ["asset-1"],
        referenceFileIds: ["file-1"],
      });

      expect(jobCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: "EDIT",
            referenceFileIds: ["file-1"],
            prompt: BASE_INPUT.prompt,
          }),
        }),
      );
      expect(loadLiveResourcesMock).toHaveBeenCalledWith(
        {
          workspaceId: BASE_INPUT.workspaceId,
          actor: photoInput.referenceFileActor,
          resourceIds: ["file-1"],
        },
        expect.any(Object),
      );
      expect(driveReadUrlMock).toHaveBeenCalledWith("drive/w/leggings.jpg");
      expect(fetchMock).toHaveBeenCalledWith(signedUrl, expect.any(Object));
      expect(snapshotUpsertMock.mock.calls[0]![0].create.finalPrompt).toBe(
        submitToQueueMock.mock.calls[0]![0].input.prompt,
      );
      expect(submitToQueueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          model: DEFAULT_IMAGE_ENDPOINT_EDIT,
          input: expect.objectContaining({
            image_urls: [
              "https://v3b.fal.media/files/source.png",
              "https://v3b.fal.media/files/l.jpg",
            ],
            prompt: expect.stringContaining(guidance),
          }),
        }),
      );
      if (brandReferenceCount)
        expect(submitToQueueMock.mock.calls[0]![0].input.prompt).not.toContain(
          "advertised product",
        );
      fetchMock.mockRestore();
    },
  );

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

  it("uses the project's Studio palette for a vector generation", async () => {
    const model = "fal-ai/recraft/v4.1/text-to-vector";
    const stored = jobRow({ model, prompt: "A fox icon" });
    jobCreateMock.mockResolvedValue(stored);
    jobFindUniqueOrThrowMock.mockResolvedValue(stored);
    projectFindUniqueMock.mockResolvedValue({
      studioBrandLook: { colors: ["#123"], fonts: [] },
    });
    submitToQueueMock.mockResolvedValue({
      kind: "queued",
      requestId: "vector-1",
    });
    await createImageJob({
      ...BASE_INPUT,
      prompt: "A fox icon",
      modelId: "recraft-v4-1-text-to-vector",
    });
    expect(submitToQueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model,
        input: expect.objectContaining({
          colors: [{ r: 17, g: 34, b: 51 }],
          prompt: expect.stringMatching(/^A fox icon\n\nFollow this project/),
        }),
      }),
    );
  });

  // A styled picture's prompt was 4,300 characters with the brand block
  // first, and the block's ad copy was lettered into it (2026-11-20).
  it("sends a picture in a library style its brief alone", async () => {
    const designMdUrl =
      "https://abc123.public.blob.vercel-storage.com/design-md/styled-brand.md";
    projectFindUniqueMock.mockResolvedValue({
      designMdUrl,
      contextMd: "We never use serif.",
    });
    ssrfSafeFetchMock.mockResolvedValue(
      new Response("# Brand\nUse crimson.", { status: 200 }),
    );
    readReferenceImageMock.mockResolvedValue({
      bytes: Buffer.from("print"),
      contentType: "image/jpeg",
      description: "a poster",
    } as never);
    uploadReferenceMock.mockResolvedValue("https://v3b.fal.media/files/s.jpg");
    const stored = jobRow({
      model: "google/nano-banana-2.1/edit",
      kind: "EDIT",
      prompt: "Image 1 is a 1930s poster.",
      referenceLibraryIds: ["0199c1f0-0000-7000-8000-000000000001"],
    });
    jobCreateMock.mockResolvedValue(stored);
    jobFindUniqueOrThrowMock.mockResolvedValue(stored);
    submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "s-1" });
    await createImageJob({
      ...BASE_INPUT,
      prompt: "Image 1 is a 1930s poster.",
      modelId: "nano-banana-2-1",
      referenceLibraryIds: ["0199c1f0-0000-7000-8000-000000000001"],
    });
    expect(submitToQueueMock.mock.calls[0]![0].input.prompt).toBe(
      "Image 1 is a 1930s poster.",
    );
  });

  // cmo-v11: the picture borrows only the reference's layout.
  it("sends a layout-only style reference as a block map, not the print", async () => {
    const print = await (await import("sharp"))
      .default({
        create: { width: 80, height: 100, channels: 3, background: "#c33" },
      })
      .jpeg()
      .toBuffer();
    readReferenceImageMock.mockResolvedValue({
      bytes: print,
      contentType: "image/jpeg",
      description: "a poster",
    } as never);
    uploadReferenceMock.mockResolvedValue("https://v3b.fal.media/files/m.png");
    const stored = jobRow({
      model: "google/nano-banana-2.1/edit",
      kind: "EDIT",
      prompt: "Image 1 is a block map.",
      referenceLibraryIds: ["0199c1f0-0000-7000-8000-000000000001"],
      styleLayoutOnly: true,
    });
    jobCreateMock.mockResolvedValue(stored);
    jobFindUniqueOrThrowMock.mockResolvedValue(stored);
    submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "m-1" });
    await createImageJob({
      ...BASE_INPUT,
      prompt: "Image 1 is a block map.",
      modelId: "nano-banana-2-1",
      referenceLibraryIds: ["0199c1f0-0000-7000-8000-000000000001"],
      styleLayoutOnly: true,
    });
    const sent = uploadReferenceMock.mock.calls[0]![0];
    expect(sent.contentType).toBe("image/png");
    expect(sent.fileName).toBe(
      "layout-0199c1f0-0000-7000-8000-000000000001.png",
    );
    const { channels } = await (await import("sharp"))
      .default(sent.bytes)
      .stats();
    // Grey only: the print's red never reaches the model.
    expect(channels[0]!.mean).toBeCloseTo(channels[1]!.mean, 0);
  });

  it("sends Design and Memory to fal and keeps the stored prompt as the brief", async () => {
    // Own URL: readDesignMdContent caches by URL across the test process.
    const designMdUrl =
      "https://abc123.public.blob.vercel-storage.com/design-md/jobs-brand.md";
    projectFindUniqueMock.mockResolvedValue({
      designMdUrl,
      contextMd: "We never use serif.",
    });
    ssrfSafeFetchMock.mockResolvedValue(
      new Response("# Brand\nUse crimson.", { status: 200 }),
    );
    submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-1" });

    await createImageJob(BASE_INPUT);

    expect(jobCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ prompt: BASE_INPUT.prompt }),
      }),
    );
    expect(submitToQueueMock.mock.calls[0]![0].input.prompt).toBe(
      [
        "Follow this project's brand.",
        "Design:\n# Brand\nUse crimson.",
        "Memory:\nWe never use serif.",
        "Brief:\na calm product shot",
      ].join("\n\n"),
    );
    const snapshot = snapshotUpsertMock.mock.calls[0]![0];
    expect(snapshot).toEqual({
      where: { jobId: "job-1" },
      create: {
        jobId: "job-1",
        ...snapshot.update,
      },
      update: {
        finalPrompt: submitToQueueMock.mock.calls[0]![0].input.prompt,
        brandContextHash: createHash("sha256")
          .update(
            [
              "Follow this project's brand.",
              "Design:\n# Brand\nUse crimson.",
              "Memory:\nWe never use serif.",
            ].join("\n\n"),
          )
          .digest("hex"),
        brandLook: Prisma.DbNull,
        route: null,
        experimentArm: null,
        assemblyVersion: STUDIO_PROMPT_ASSEMBLY_VERSION,
        templateId: null,
        creativeDirection: null,
        variationIndex: null,
      },
    });
  });

  it("persists the generation context and brand look with the exact headline guidance", async () => {
    const context = {
      templateId: "social-post",
      creativeDirection: "lifestyle",
      variationIndex: 0,
    };
    const look = { colors: ["#123456"], fonts: ["Inter"] };
    const settings = {
      ...BASE_INPUT.settings,
      route: "photo_ad" as const,
      experimentArm: "router:opus-5.5" as const,
    };
    const stored = jobRow({
      ...context,
      settings,
      exportHeadline: "Approved headline",
    });
    projectFindUniqueMock.mockResolvedValue({ studioBrandLook: look });
    jobCreateMock.mockResolvedValue(stored);
    jobFindUniqueOrThrowMock.mockResolvedValue(stored);
    submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-1" });

    await createImageJob({
      ...BASE_INPUT,
      ...context,
      experimentArm: settings.experimentArm,
      route: settings.route,
    });

    expect(jobCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ ...context, settings }),
    });
    const finalPrompt = submitToQueueMock.mock.calls[0]![0].input.prompt;
    expect(finalPrompt).toContain(
      "Studio adds the approved headline after generation.",
    );
    expect(snapshotUpsertMock).toHaveBeenCalledWith({
      where: { jobId: "job-1" },
      create: expect.objectContaining({
        ...context,
        finalPrompt,
        brandLook: look,
        experimentArm: settings.experimentArm,
        route: settings.route,
        brandContextHash: createHash("sha256")
          .update(
            [
              "Follow this project's brand.",
              "Use these Studio choices for the ad's palette and fonts. They take precedence over any palette or typefaces in the other brand context.",
              "Palette: #123456",
              "Fonts: Inter",
            ].join("\n\n"),
          )
          .digest("hex"),
      }),
      update: expect.objectContaining({
        ...context,
        finalPrompt,
        brandLook: look,
        experimentArm: settings.experimentArm,
        route: settings.route,
      }),
    });
  });

  it("queues the job and logs a snapshot failure", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "Could not save the prompt snapshot of an image generation",
      ["The database write of the snapshot failed"],
    );
    snapshotUpsertMock.mockRejectedValueOnce(
      new Error("snapshot unavailable: SECRET-PROMPT-SENTINEL"),
    );
    submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-1" });

    await expect(createImageJob(BASE_INPUT)).resolves.toMatchObject({
      status: "QUEUED",
    });
    await Promise.all(waitUntilMock.mock.calls.map(([work]) => work));
    // Its own event, after the response; the write's error can quote the prompt.
    expect(warnings[0]?.event).toMatchObject({
      operation: "image_prompt_snapshot",
      imageJobs: [{ id: "job-1", failure: { errorName: "Error" } }],
    });
    expect(warnings[0]?.cause).toBeUndefined();
    expect(JSON.stringify(coreLogEvents())).not.toContain(
      "SECRET-PROMPT-SENTINEL",
    );
  });

  it("does not wait for a snapshot write before submitting or returning the job", async () => {
    // Held open while the job is created and returned, then settled, so the
    // drain after the test finishes it even when an assertion fails.
    let finishSnapshot = () => {};
    snapshotUpsertMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishSnapshot = resolve;
      }),
    );
    submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-1" });

    try {
      await expect(createImageJob(BASE_INPUT)).resolves.toMatchObject({
        status: "QUEUED",
      });
      expect(snapshotUpsertMock).toHaveBeenCalledOnce();
      expect(waitUntilMock).toHaveBeenCalledWith(expect.any(Promise));
      expect(submitToQueueMock).toHaveBeenCalledOnce();
    } finally {
      finishSnapshot();
    }
  });

  it("still sends the brief when Design cannot be read", async () => {
    projectFindUniqueMock.mockResolvedValue({
      // A file no earlier test read: read files are cached by URL.
      designMdUrl:
        "https://abc123.public.blob.vercel-storage.com/design-md/unread-jobs.md",
      contextMd: null,
    });
    ssrfSafeFetchMock.mockRejectedValue(new Error("blocked"));
    submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-1" });

    await createImageJob(BASE_INPUT);

    expect(submitToQueueMock.mock.calls[0]![0].input.prompt).toBe(
      BASE_INPUT.prompt,
    );
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

/**
 * Never called: `tsc` checks it. Image Studio is Mainnet only, so its
 * settlement takes a scope the type checker knows is Mainnet's: a request's
 * scope, which may name Preprod, and a Preprod scope must not compile.
 */
export function _settlementTakesOnlyMainnet(
  create: typeof createNetworkScope,
  requestScope: NetworkScope,
) {
  const mainnet: MainnetScope = create("mainnet");
  const preprod = create("preprod");
  const cancel = { jobId: "j", projectId: "p", workspaceId: "w", userId: "u" };
  const stale = { olderThanMs: 1, limit: 1 };

  void settleWithMedia(mainnet, "j", "u");
  void failImageJob(mainnet, "j", "unknown");
  void reconcileJob(mainnet, "j");
  void reconcileProjectJobs(mainnet, "p");
  void reconcileWorkspaceJobs(mainnet, "w");
  void reconcileStaleJobs({ scope: mainnet, ...stale });
  void requestCancel({ scope: mainnet, ...cancel });

  // @ts-expect-error a request's scope may name Preprod
  void settleWithMedia(requestScope, "j", "u");
  // @ts-expect-error a request's scope may name Preprod
  void failImageJob(requestScope, "j", "unknown");
  // @ts-expect-error a request's scope may name Preprod
  void reconcileJob(requestScope, "j");
  // @ts-expect-error a request's scope may name Preprod
  void reconcileProjectJobs(requestScope, "p");
  // @ts-expect-error a request's scope may name Preprod
  void reconcileWorkspaceJobs(requestScope, "w");
  // @ts-expect-error a request's scope may name Preprod
  void reconcileStaleJobs({ scope: requestScope, ...stale });
  // @ts-expect-error a request's scope may name Preprod
  void requestCancel({ scope: requestScope, ...cancel });

  // @ts-expect-error a Preprod scope
  void settleWithMedia(preprod, "j", "u");
  // @ts-expect-error a Preprod scope
  void failImageJob(preprod, "j", "unknown");
  // @ts-expect-error a Preprod scope
  void reconcileJob(preprod, "j");
  // @ts-expect-error a Preprod scope
  void reconcileProjectJobs(preprod, "p");
  // @ts-expect-error a Preprod scope
  void reconcileWorkspaceJobs(preprod, "w");
  // @ts-expect-error a Preprod scope
  void reconcileStaleJobs({ scope: preprod, ...stale });
  // @ts-expect-error a Preprod scope
  void requestCancel({ scope: preprod, ...cancel });
}
