import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The money contract for image generation: **charge on success**.
 *
 * The studio quotes a price at submit and takes it when it hands over an image.
 * There is no reservation and no refund, because nothing is taken until there is
 * something to pay for. Four properties, and these tests exist for them:
 *
 * 1. Submitting quotes the catalog price on the job row and takes no money.
 * 2. A submission the balance cannot cover is refused before a provider call, and
 *    the balance has to cover this image *plus* the quotes already in flight.
 * 3. Delivering an image debits exactly the quote, exactly once, however many
 *    settlers race the same job.
 * 4. A failure moves no money at all — and a balance that fell between submit and
 *    delivery costs the person the credits, never the image.
 */

const {
  jobAggregateMock,
  jobCountMock,
  jobCreateMock,
  jobFindUniqueMock,
  jobFindUniqueOrThrowMock,
  jobUpdateMock,
  jobUpdateManyMock,
  jobFindManyMock,
  assetFindUniqueMock,
  assetFindFirstMock,
  assetCreateMock,
  getEnvMock,
  submitToQueueMock,
  requireProjectAccessMock,
  createTaskEventTransactionMock,
  getBalanceMock,
} = vi.hoisted(() => ({
  jobAggregateMock: vi.fn(),
  jobCountMock: vi.fn(),
  jobCreateMock: vi.fn(),
  jobFindUniqueMock: vi.fn(),
  jobFindUniqueOrThrowMock: vi.fn(),
  jobUpdateMock: vi.fn(),
  jobUpdateManyMock: vi.fn(),
  jobFindManyMock: vi.fn(),
  assetFindUniqueMock: vi.fn(),
  assetFindFirstMock: vi.fn(),
  assetCreateMock: vi.fn(),
  getEnvMock: vi.fn(),
  submitToQueueMock: vi.fn(),
  requireProjectAccessMock: vi.fn(),
  createTaskEventTransactionMock: vi.fn(),
  getBalanceMock: vi.fn(),
}));

vi.mock("@/services/image-studio-files.service", () => ({
  publishImageToFiles: vi.fn(),
}));
vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
  getBetterAuthPublicBaseUrl: () => "http://localhost:3001",
}));

vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: { getBalance: getBalanceMock },
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
      findFirst: assetFindFirstMock,
      create: assetCreateMock,
      findMany: vi.fn(),
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
  downloadImage: vi.fn(async () => ({
    bytes: pngBytes(1024, 1024),
    contentType: "image/png",
  })),
}));

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async () => ({ pathname: "projects/p/image-studio/job-1-abc" })),
}));

vi.mock("@/helpers/task-credits", async () => ({
  ...(await vi.importActual<typeof import("@/helpers/task-credits")>(
    "@/helpers/task-credits",
  )),
  createTaskEventTransaction: createTaskEventTransactionMock,
}));

vi.mock("@/services/image-studio-assets.service", () => ({
  readAssetBytes: vi.fn(),
}));

import { CORE_API_ERROR_KINDS, convertCreditsToCents } from "@sokosumi/utils";

import { unprocessableEntity } from "@/helpers/error";
import { imageModel } from "@/lib/image-studio/catalog";
import { creditsPerImage } from "@/lib/image-studio/image-model";
import {
  createImageJob,
  failImageJob,
  settleWithImage,
} from "@/services/image-studio-jobs.service";

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const data = new DataView(bytes.buffer);
  data.setUint32(16, width);
  data.setUint32(20, height);
  return bytes;
}

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

/** 8 credits: fal lists Gemini 3.1 Flash at $0.08 per image. */
const FLASH_1K_CREDITS = creditsPerImage(imageModel("gemini-flash"), {
  aspectRatio: "1:1",
  resolution: "1K",
});
const FLASH_1K_CENTS = convertCreditsToCents(FLASH_1K_CREDITS);
/** Comfortably more than one image, so a test has to opt into a shortfall. */
const RICH_BALANCE = FLASH_1K_CENTS * 10n;

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    projectId: "project-1",
    workspaceId: "workspace-1",
    requestedByUserId: "user-1",
    model: "fal-ai/gemini-3.1-flash-image-preview",
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
    chargedCents: FLASH_1K_CENTS,
    transactionId: null,
    ...overrides,
  };
}

/** A job fal has finished, ready for `settleWithImage`. */
function settleableJob(overrides: Record<string, unknown> = {}) {
  return jobRow({
    status: "QUEUED",
    falRequestId: "fal-1",
    submitAttempts: 1,
    asset: null,
    ...overrides,
  });
}

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
  jobCountMock.mockResolvedValue(0);
  jobAggregateMock.mockResolvedValue({ _sum: { chargedCents: null } });
  getBalanceMock.mockResolvedValue(RICH_BALANCE);
  jobFindUniqueMock.mockResolvedValue(null);
  jobCreateMock.mockImplementation(async () => jobRow());
  jobFindUniqueOrThrowMock.mockImplementation(async () => jobRow());
  jobUpdateMock.mockImplementation(async ({ data }) =>
    jobRow({ ...data, status: data.status ?? "PENDING" }),
  );
  jobUpdateManyMock.mockResolvedValue({ count: 1 });
  assetFindUniqueMock.mockResolvedValue(null);
  assetFindFirstMock.mockResolvedValue(null);
  assetCreateMock.mockResolvedValue({ id: "asset-1" });
  createTaskEventTransactionMock.mockResolvedValue("txn-debit-1");
  submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-1" });
});

describe("submitting quotes, and takes nothing", () => {
  it("writes the catalog price on the row without debiting anything", async () => {
    await createImageJob(BASE_INPUT);

    // The quote the composer showed, from the same catalog row and the same
    // function, so the figure taken at delivery is the one they agreed to.
    expect(FLASH_1K_CREDITS).toBe(8);
    expect(jobCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ chargedCents: FLASH_1K_CENTS }),
      }),
    );
    // No money, and no `transactionId` — there is no image yet.
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
    expect(jobCreateMock.mock.calls[0]![0].data).not.toHaveProperty(
      "transactionId",
    );
  });

  it("reads the balance without consuming from it", async () => {
    await createImageJob(BASE_INPUT);

    expect(getBalanceMock).toHaveBeenCalledWith(
      "user-1",
      null,
      expect.anything(),
    );
  });

  it("checks the balance against the organization pot when there is one", async () => {
    requireProjectAccessMock.mockResolvedValue({
      projectId: "project-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      organizationId: "org-1",
    });

    await createImageJob(BASE_INPUT);

    expect(getBalanceMock).toHaveBeenCalledWith(
      "user-1",
      "org-1",
      expect.anything(),
    );
  });
});

describe("a submission the balance cannot cover", () => {
  it("is refused before a provider call, with nothing written", async () => {
    getBalanceMock.mockResolvedValue(FLASH_1K_CENTS - 1n);

    const refusal = await createImageJob(BASE_INPUT).catch(
      (error: unknown) => error,
    );

    expect(refusal).toMatchObject({ status: 422 });
    expect((refusal as { cause?: unknown }).cause).toMatchObject({
      kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE,
    });
    expect(jobCreateMock).not.toHaveBeenCalled();
    expect(submitToQueueMock).not.toHaveBeenCalled();
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
  });

  it("names the shortfall in credits, in the studio's own words", async () => {
    getBalanceMock.mockResolvedValue(convertCreditsToCents(3));

    const refusal = (await createImageJob(BASE_INPUT).catch(
      (error: unknown) => error,
    )) as Error;

    expect(refusal.message).toBe(
      "Not enough credits. This image costs 8 and your balance is 3.",
    );
    // Not cents, and not the repository's own bucket arithmetic.
    expect(refusal.message).not.toMatch(/cents|consume|bucket|\d{6,}/);
  });

  it("counts the quotes already in flight, not just this image", async () => {
    // The window concurrent submissions open: a balance of 16 covers one 8-credit
    // image twice over, but not a third when two are already generating.
    getBalanceMock.mockResolvedValue(FLASH_1K_CENTS * 2n);
    jobAggregateMock.mockResolvedValue({
      _sum: { chargedCents: FLASH_1K_CENTS * 2n },
    });

    const refusal = (await createImageJob(BASE_INPUT).catch(
      (error: unknown) => error,
    )) as Error;

    expect(refusal).toMatchObject({ status: 422 });
    expect(refusal.message).toBe(
      "Not enough credits. This image costs 8, your balance is 16, and 16 is already committed to images still generating.",
    );
    expect(jobCreateMock).not.toHaveBeenCalled();

    // The aggregate is over this person's own unsettled jobs.
    const where = jobAggregateMock.mock.calls[0]![0].where;
    expect(where.requestedByUserId).toBe("user-1");
    expect(where.status.in).toEqual([
      "PENDING",
      "SUBMITTING",
      "QUEUED",
      "RUNNING",
    ]);
  });

  it("allows a submission the balance covers alongside what is in flight", async () => {
    getBalanceMock.mockResolvedValue(FLASH_1K_CENTS * 3n);
    jobAggregateMock.mockResolvedValue({
      _sum: { chargedCents: FLASH_1K_CENTS * 2n },
    });

    await expect(createImageJob(BASE_INPUT)).resolves.toBeDefined();
    expect(jobCreateMock).toHaveBeenCalled();
  });
});

describe("delivering an image is when the money moves", () => {
  it("debits exactly the quote, once", async () => {
    jobFindUniqueMock.mockResolvedValue(settleableJob());

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    expect(createTaskEventTransactionMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        userId: "user-1",
        organizationId: null,
        cents: FLASH_1K_CENTS,
      }),
    );
    // Recorded on the row beside the asset, in the same transaction.
    const settled = jobUpdateManyMock.mock.calls.at(-1)![0].data;
    expect(settled.status).toBe("SUCCEEDED");
    expect(settled.chargedCents).toBe(FLASH_1K_CENTS);
    expect(settled.transactionId).toBe("txn-debit-1");
    expect(assetCreateMock).toHaveBeenCalledOnce();
  });

  it("debits once when the same job is settled twice", async () => {
    // A webhook and a poll arriving together. The second settler finds the asset
    // this job already has and returns before any money moves.
    jobFindUniqueMock.mockResolvedValue(settleableJob());
    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    assetFindUniqueMock.mockResolvedValue({ id: "asset-1" });
    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    expect(createTaskEventTransactionMock).toHaveBeenCalledOnce();
    expect(assetCreateMock).toHaveBeenCalledOnce();
  });

  it("does not debit a job whose asset already exists", async () => {
    jobFindUniqueMock.mockResolvedValue(
      settleableJob({ asset: { id: "asset-1" } }),
    );

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
  });

  it("keeps the image and charges nothing when the balance no longer covers it", async () => {
    // Money must never cost somebody an image the platform has already paid fal
    // for. `prepareConsumption` cannot overdraw, so a balance that fell between
    // submit and delivery makes the debit throw — and letting that abort the
    // transaction would leave the asset unwritten and settlement retrying forever.
    jobFindUniqueMock.mockResolvedValue(settleableJob());
    createTaskEventTransactionMock.mockRejectedValue(
      unprocessableEntity("Insufficient balance", {
        kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE,
      }),
    );

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    // The image is stored and the job succeeds.
    expect(assetCreateMock).toHaveBeenCalledOnce();
    const settled = jobUpdateManyMock.mock.calls.at(-1)![0].data;
    expect(settled.status).toBe("SUCCEEDED");
    // And it reads as free, because it was. Leaving the quote on the row would
    // make the History trigger report a charge no transaction backs.
    expect(settled.chargedCents).toBe(0n);
    expect(settled.transactionId).toBeNull();
  });

  it("retries rather than giving an image away on a transient failure", async () => {
    // Only a shortfall is survivable. A pool timeout must abort so the settler can
    // try again, not silently hand over an image for nothing.
    jobFindUniqueMock.mockResolvedValue(settleableJob());
    createTaskEventTransactionMock.mockRejectedValue(
      new Error("connection terminated unexpectedly"),
    );

    await expect(
      settleWithImage("job-1", "https://v3b.fal.media/files/a.png"),
    ).rejects.toThrow("connection terminated");
    expect(assetCreateMock).not.toHaveBeenCalled();
  });

  it("stores a free image without inventing a transaction", async () => {
    jobFindUniqueMock.mockResolvedValue(settleableJob({ chargedCents: 0n }));

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
    expect(assetCreateMock).toHaveBeenCalledOnce();
  });
});

describe("a failed generation moves no money", () => {
  it("takes nothing when the provider refuses the submission", async () => {
    submitToQueueMock.mockResolvedValue({
      kind: "rejected",
      status: 422,
      message: '{"detail":"Unexpected status code: 422"}',
    });

    const job = await createImageJob(BASE_INPUT);

    expect(job.status).toBe("FAILED");
    // Nothing to give back, because nothing was ever taken. There is no refund
    // path in the studio any more.
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
  });

  it("takes nothing when fal's runner reports an error", async () => {
    await failImageJob(
      "job-1",
      "provider_error",
      "Unexpected status code: 422",
    );

    const written = jobUpdateManyMock.mock.calls[0]![0].data;
    expect(written.status).toBe("FAILED");
    expect(written.failureReason).toBe("provider_error");
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
  });

  it("takes nothing when the request could not be prepared", async () => {
    // A model fal withdrew between submit and send.
    const withdrawn = jobRow({ model: "fal-ai/withdrawn-last-year" });
    jobCreateMock.mockResolvedValue(withdrawn);
    jobFindUniqueOrThrowMock.mockResolvedValue(withdrawn);

    const job = await createImageJob(BASE_INPUT);

    expect(submitToQueueMock).not.toHaveBeenCalled();
    expect(job.status).toBe("FAILED");
    expect(jobUpdateMock.mock.calls[0]![0].data.failureReason).toBe(
      "request_not_supported",
    );
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
  });

  it("takes nothing when the project's access went away at settlement", async () => {
    jobFindUniqueMock.mockResolvedValue(settleableJob());
    requireProjectAccessMock.mockRejectedValue(
      Object.assign(new Error("Project not found"), { status: 404 }),
    );

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    const orphaned = jobUpdateManyMock.mock.calls.at(-1)![0].data;
    expect(orphaned.status).toBe("ORPHANED");
    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
    expect(assetCreateMock).not.toHaveBeenCalled();
  });
});
