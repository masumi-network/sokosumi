import { convertCreditsToCents } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Video jobs ride the image job's row, lease, quote and webhook. What is new is
 * the request: a video model, a length, and optionally a gallery image to
 * animate — all checked before a row is reserved or fal is called.
 */

const {
  jobCountMock,
  jobCreateMock,
  jobFindUniqueMock,
  jobFindUniqueOrThrowMock,
  jobUpdateMock,
  jobUpdateManyMock,
  assetFindFirstMock,
  assetFindManyMock,
  getEnvMock,
  submitToQueueMock,
  uploadReferenceMock,
  readAssetBytesMock,
  requireProjectAccessMock,
  getBalanceMock,
  projectFindUniqueMock,
} = vi.hoisted(() => ({
  jobCountMock: vi.fn(),
  jobCreateMock: vi.fn(),
  jobFindUniqueMock: vi.fn(),
  jobFindUniqueOrThrowMock: vi.fn(),
  jobUpdateMock: vi.fn(),
  jobUpdateManyMock: vi.fn(),
  assetFindFirstMock: vi.fn(),
  assetFindManyMock: vi.fn(),
  getEnvMock: vi.fn(),
  submitToQueueMock: vi.fn(),
  uploadReferenceMock: vi.fn(),
  readAssetBytesMock: vi.fn(),
  requireProjectAccessMock: vi.fn(),
  getBalanceMock: vi.fn(),
  projectFindUniqueMock: vi.fn(),
}));

vi.mock("@/services/image-studio-files.service", () => ({
  publishStudioAssetToFiles: vi.fn(),
}));
vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: { getBalance: getBalanceMock },
}));
vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
  getBetterAuthPublicBaseUrl: () => "http://localhost:3001",
}));
vi.mock("@/lib/db/prisma", () => {
  const client = {
    projectImageJob: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { chargedCents: null } }),
      count: jobCountMock,
      create: jobCreateMock,
      findUnique: jobFindUniqueMock,
      findUniqueOrThrow: jobFindUniqueOrThrowMock,
      findMany: vi.fn().mockResolvedValue([]),
      update: jobUpdateMock,
      updateMany: jobUpdateManyMock,
    },
    projectImageAsset: {
      findFirst: assetFindFirstMock,
      findMany: assetFindManyMock,
    },
    project: { findUnique: projectFindUniqueMock },
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

import { createVideoJob } from "@/services/image-studio-jobs.service";

const BASE_INPUT = {
  projectId: "project-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  sessionId: null,
  prompt: "a sunrise over the harbour",
  settings: {},
  sourceAssetId: null,
  idempotencyKey: "key-abcdefgh",
};

/** The row the mocked insert hands back: whatever was written, as PENDING. */
function storedRow(data: Record<string, unknown>) {
  return {
    id: "job-1",
    status: "PENDING",
    submitAttempts: 0,
    createdAt: new Date(),
    ...data,
  };
}

let stored: Record<string, unknown> = {};

beforeEach(() => {
  vi.clearAllMocks();
  getEnvMock.mockReturnValue({
    FAL_KEY: "k",
    IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN: "studio-private-store-token",
  });
  requireProjectAccessMock.mockResolvedValue({
    projectId: "project-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    organizationId: null,
  });
  getBalanceMock.mockResolvedValue(10_000_000_000_000n);
  jobCountMock.mockResolvedValue(0);
  jobFindUniqueMock.mockResolvedValue(null);
  jobCreateMock.mockImplementation(async ({ data }) => {
    stored = storedRow(data);
    return stored;
  });
  jobFindUniqueOrThrowMock.mockImplementation(async () => stored);
  jobUpdateMock.mockImplementation(async ({ data }) => ({
    ...stored,
    ...data,
  }));
  jobUpdateManyMock.mockResolvedValue({ count: 1 });
  projectFindUniqueMock.mockResolvedValue({
    designMdUrl: null,
    contextMd: null,
  });
  submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-1" });
});

describe("a video from a prompt", () => {
  it("reserves a text-to-video row on the default model, quoted per second", async () => {
    await createVideoJob(BASE_INPUT);

    expect(jobCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "TEXT_TO_VIDEO",
        model: "minimax/h3-max-turbo/text-to-video",
        settings: {
          aspectRatio: "9:16",
          durationSeconds: 5,
          resolution: "768P",
        },
        referenceAssetIds: [],
        // $0.04/s at 768P for 5 seconds.
        chargedCents: convertCreditsToCents(20),
      }),
    });
  });

  it("sends the schema's own fields: length, resolution, frame and required defaults", async () => {
    await createVideoJob({
      ...BASE_INPUT,
      modelId: "h3-max",
      settings: {
        aspectRatio: "16:9",
        durationSeconds: 10,
        resolution: "480P",
      },
    });

    expect(submitToQueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "minimax/h3-max/text-to-video",
        input: {
          prompt: BASE_INPUT.prompt,
          prompt_expansion_mode: "balanced",
          duration: 10,
          resolution: "480P",
          aspect_ratio: "16:9",
        },
      }),
    );
    expect(jobCreateMock.mock.calls[0]![0].data.chargedCents).toBe(
      convertCreditsToCents(50),
    );
  });

  it("refuses a length or resolution the model does not offer before reserving", async () => {
    await expect(
      createVideoJob({ ...BASE_INPUT, settings: { durationSeconds: 7 } }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      createVideoJob({ ...BASE_INPUT, settings: { resolution: "1080P" } }),
    ).rejects.toMatchObject({ status: 422 });
    expect(jobCreateMock).not.toHaveBeenCalled();
    expect(submitToQueueMock).not.toHaveBeenCalled();
  });

  it("refuses an image-to-video model without an image", async () => {
    await expect(
      createVideoJob({ ...BASE_INPUT, modelId: "h3-max-turbo-animate" }),
    ).rejects.toMatchObject({ status: 422 });
    expect(jobCreateMock).not.toHaveBeenCalled();
  });

  it("returns the existing job for a replayed key and never calls fal again", async () => {
    jobFindUniqueMock.mockResolvedValue(
      storedRow({ kind: "TEXT_TO_VIDEO", status: "QUEUED" }),
    );

    const job = await createVideoJob(BASE_INPUT);

    expect(job.status).toBe("QUEUED");
    expect(jobCreateMock).not.toHaveBeenCalled();
    expect(submitToQueueMock).not.toHaveBeenCalled();
  });
});

describe("animating a gallery image", () => {
  beforeEach(() => {
    assetFindFirstMock.mockResolvedValue({ mediaType: "IMAGE" });
    assetFindManyMock.mockResolvedValue([
      {
        id: "asset-1",
        blobPathname: "projects/p/image-studio/a",
        contentType: "image/png",
        bytes: 3,
      },
    ]);
    readAssetBytesMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    uploadReferenceMock.mockResolvedValue(
      "https://v3b.fal.media/files/ref.png",
    );
  });

  it("sends the still in the model's own field and no frame of its own", async () => {
    await createVideoJob({ ...BASE_INPUT, sourceAssetId: "asset-1" });

    expect(jobCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "IMAGE_TO_VIDEO",
        model: "minimax/h3-max-turbo/image-to-video",
        referenceAssetIds: ["asset-1"],
      }),
    });
    const input = submitToQueueMock.mock.calls[0]![0].input;
    expect(input.image_url).toBe("https://v3b.fal.media/files/ref.png");
    expect(input).not.toHaveProperty("aspect_ratio");
  });

  it("uses Kling's start frame field for Kling", async () => {
    await createVideoJob({
      ...BASE_INPUT,
      modelId: "kling-v4-animate",
      sourceAssetId: "asset-1",
    });

    const input = submitToQueueMock.mock.calls[0]![0].input;
    expect(input.start_image_url).toBe("https://v3b.fal.media/files/ref.png");
    expect(input.resolution).toBe("720p");
  });

  it("refuses to animate a video, or an asset from another project", async () => {
    assetFindFirstMock.mockResolvedValueOnce({ mediaType: "VIDEO" });
    await expect(
      createVideoJob({ ...BASE_INPUT, sourceAssetId: "asset-1" }),
    ).rejects.toMatchObject({ status: 422 });

    assetFindFirstMock.mockResolvedValueOnce(null);
    await expect(
      createVideoJob({ ...BASE_INPUT, sourceAssetId: "asset-1" }),
    ).rejects.toMatchObject({ status: 404 });

    expect(jobCreateMock).not.toHaveBeenCalled();
  });
});
