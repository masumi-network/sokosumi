import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The money contract for image generation.
 *
 * Three properties, and the tests below exist for them and nothing else:
 *
 * 1. Reserving a job debits exactly what the catalog says one image costs, in
 *    the same transaction that writes the row.
 * 2. Not enough credits means no job row and no provider call at all.
 * 3. A generation that failed costs nothing: every terminal failure refunds, the
 *    refund happens once however many writers race it, and a submission whose
 *    outcome is unknown is never refunded automatically.
 */

const {
  jobCountMock,
  jobCreateMock,
  jobFindUniqueMock,
  jobFindUniqueOrThrowMock,
  jobUpdateMock,
  jobUpdateManyMock,
  jobFindManyMock,
  getEnvMock,
  submitToQueueMock,
  requireProjectAccessMock,
  createTaskEventTransactionMock,
} = vi.hoisted(() => ({
  jobCountMock: vi.fn(),
  jobCreateMock: vi.fn(),
  jobFindUniqueMock: vi.fn(),
  jobFindUniqueOrThrowMock: vi.fn(),
  jobUpdateMock: vi.fn(),
  jobUpdateManyMock: vi.fn(),
  jobFindManyMock: vi.fn(),
  getEnvMock: vi.fn(),
  submitToQueueMock: vi.fn(),
  requireProjectAccessMock: vi.fn(),
  createTaskEventTransactionMock: vi.fn(),
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
    projectImageAsset: { findUnique: vi.fn(), findMany: vi.fn() },
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
}));

vi.mock("@/helpers/task-credits", () => ({
  createTaskEventTransaction: createTaskEventTransactionMock,
}));

vi.mock("@/services/image-studio-assets.service", () => ({
  readAssetBytes: vi.fn(),
}));

import { convertCreditsToCents } from "@sokosumi/utils";

import { unprocessableEntity } from "@/helpers/error";
import { imageModel } from "@/lib/image-studio/catalog";
import { creditsPerImage } from "@/lib/image-studio/image-model";
import {
  createImageJob,
  failImageJob,
  refundFailedImageJobs,
  refundImageJobCharge,
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

/** 8 credits: fal lists Gemini 3.1 Flash at $0.08 per image. */
const FLASH_1K_CREDITS = creditsPerImage(imageModel("gemini-flash"), {
  aspectRatio: "1:1",
  resolution: "1K",
});
const FLASH_1K_CENTS = convertCreditsToCents(FLASH_1K_CREDITS);

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    projectId: "project-1",
    workspaceId: "workspace-1",
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
    transactionId: "txn-debit-1",
    refundTransactionId: null,
    ...overrides,
  };
}

/**
 * The row shape `refundImageJobCharge` reads, including the ledger transaction it
 * refunds against. The spend is stored negative, which is what makes the refund's
 * positive amount its exact mirror.
 */
function refundableRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    status: "FAILED",
    chargedCents: FLASH_1K_CENTS,
    refundTransactionId: null,
    transaction: {
      id: "txn-debit-1",
      userId: "user-1",
      organizationId: null,
      amount: FLASH_1K_CENTS * BigInt(-1),
    },
    ...overrides,
  };
}

/** True for the refund's own read, which is the only one selecting the refund id. */
function isRefundLookup(args: { select?: Record<string, unknown> }): boolean {
  return args?.select?.refundTransactionId === true;
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
  jobFindUniqueMock.mockResolvedValue(null);
  jobCreateMock.mockImplementation(async () => jobRow());
  jobFindUniqueOrThrowMock.mockImplementation(async () => jobRow());
  jobUpdateMock.mockImplementation(async ({ data }) =>
    jobRow({ ...data, status: data.status ?? "PENDING" }),
  );
  jobUpdateManyMock.mockResolvedValue({ count: 1 });
  createTaskEventTransactionMock.mockResolvedValue("txn-debit-1");
  submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-1" });
});

describe("reserving credits", () => {
  it("debits the catalog figure in the same transaction that creates the row", async () => {
    await createImageJob(BASE_INPUT);

    expect(createTaskEventTransactionMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        userId: "user-1",
        organizationId: null,
        cents: FLASH_1K_CENTS,
      }),
    );
    // Same catalog row, same function, and therefore the same number the
    // composer's pre-flight estimate showed.
    expect(FLASH_1K_CREDITS).toBe(8);
    expect(jobCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          chargedCents: FLASH_1K_CENTS,
          transactionId: "txn-debit-1",
        }),
      }),
    );
  });

  it("charges an area-priced model by the frame, not by a flat figure", async () => {
    const wide = { ...BASE_INPUT.settings, aspectRatio: "16:9" };
    jobCreateMock.mockResolvedValue(
      jobRow({ model: "fal-ai/flux-2-pro", settings: wide }),
    );
    jobFindUniqueOrThrowMock.mockResolvedValue(
      jobRow({ model: "fal-ai/flux-2-pro", settings: wide }),
    );
    await createImageJob({
      ...BASE_INPUT,
      modelId: "flux-2-pro",
      settings: wide,
    });
    // $0.03/MP over 1024x576 is 2 credits, against 4 for the square frame.
    expect(createTaskEventTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({ cents: convertCreditsToCents(2) }),
    );
  });

  it("charges the organization pot when the workspace belongs to one", async () => {
    requireProjectAccessMock.mockResolvedValue({
      projectId: "project-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      organizationId: "org-1",
    });
    await createImageJob(BASE_INPUT);
    expect(createTaskEventTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1" }),
    );
  });

  it("buys nothing and writes nothing when the balance is short", async () => {
    createTaskEventTransactionMock.mockRejectedValue(
      unprocessableEntity("Insufficient balance", {
        kind: "INSUFFICIENT_BALANCE",
      }),
    );

    await expect(createImageJob(BASE_INPUT)).rejects.toMatchObject({
      status: 422,
    });
    // The composer can say "not enough credits" because nothing else happened:
    // no row to clean up, and fal was never called.
    expect(jobCreateMock).not.toHaveBeenCalled();
    expect(submitToQueueMock).not.toHaveBeenCalled();
  });

  it("does not debit again for a replayed idempotency key", async () => {
    jobFindUniqueMock.mockResolvedValue(jobRow({ status: "QUEUED" }));

    await createImageJob(BASE_INPUT);

    expect(createTaskEventTransactionMock).not.toHaveBeenCalled();
    expect(jobCreateMock).not.toHaveBeenCalled();
  });
});

describe("refunding a failed generation", () => {
  it("costs the person nothing end to end: reserve, fail, net zero", async () => {
    submitToQueueMock.mockResolvedValue({
      kind: "rejected",
      status: 422,
      message: "prompt rejected",
    });
    jobFindUniqueMock.mockImplementation(async (args) =>
      isRefundLookup(args) ? refundableRow() : null,
    );

    const job = await createImageJob(BASE_INPUT);
    expect(job.status).toBe("FAILED");

    const debited = createTaskEventTransactionMock.mock.calls[0]![0].cents;
    const refund = jobUpdateMock.mock.calls.find(
      (call) => call[0].data?.refundTransaction,
    );
    expect(refund).toBeDefined();
    const credited = refund![0].data.refundTransaction.create.amount;
    // The debit went out as a negative transaction; the refund is its exact
    // mirror, so the two sum to zero and a failed generation is free.
    expect(credited).toBe(debited);
    expect(credited + debited * BigInt(-1)).toBe(0n);
  });

  it("refunds once when several writers race the same failed job", async () => {
    // The second caller sees the refund the first one wrote.
    let refunded = false;
    jobFindUniqueMock.mockImplementation(async (args) => {
      if (!isRefundLookup(args)) return null;
      return refundableRow({
        refundTransactionId: refunded ? "txn-refund-1" : null,
      });
    });
    jobUpdateMock.mockImplementation(async () => {
      refunded = true;
      return jobRow({ refundTransactionId: "txn-refund-1" });
    });

    expect(await refundImageJobCharge("job-1")).toBe(true);
    expect(await refundImageJobCharge("job-1")).toBe(false);
    expect(jobUpdateMock).toHaveBeenCalledOnce();
  });

  it("never refunds a submission whose outcome is unknown", async () => {
    // fal may well have received and charged for this request, and the row stays
    // recoverable into a real image. Paying it back automatically would hand the
    // person credits for an image the platform did pay for.
    jobFindUniqueMock.mockImplementation(async (args) =>
      isRefundLookup(args)
        ? refundableRow({ status: "SUBMISSION_UNCERTAIN" })
        : null,
    );

    expect(await refundImageJobCharge("job-1")).toBe(false);
    expect(jobUpdateMock).not.toHaveBeenCalled();
  });

  it("never refunds a job that produced an image", async () => {
    jobFindUniqueMock.mockImplementation(async (args) =>
      isRefundLookup(args) ? refundableRow({ status: "SUCCEEDED" }) : null,
    );
    expect(await refundImageJobCharge("job-1")).toBe(false);
  });

  it.each(["FAILED", "CANCELED", "ORPHANED"])(
    "refunds a %s job",
    async (status) => {
      jobFindUniqueMock.mockImplementation(async (args) =>
        isRefundLookup(args) ? refundableRow({ status }) : null,
      );
      expect(await refundImageJobCharge("job-1")).toBe(true);
    },
  );

  it("does nothing for a job that was never charged", async () => {
    jobFindUniqueMock.mockImplementation(async (args) =>
      isRefundLookup(args)
        ? refundableRow({ chargedCents: null, transaction: null })
        : null,
    );
    expect(await refundImageJobCharge("job-1")).toBe(false);
    expect(jobUpdateMock).not.toHaveBeenCalled();
  });

  it("swallows a refund failure so settlement is never aborted by it", async () => {
    // The sweep is what makes the money come back; throwing here would roll back
    // a settlement that has already stored a paid-for image.
    jobFindUniqueMock.mockRejectedValue(new Error("connection lost"));
    await expect(refundImageJobCharge("job-1")).resolves.toBe(false);
  });

  it("refunds through failImageJob, which every terminal path now goes through", async () => {
    // The guarantee fal's completion webhook relies on. That handler used to write
    // FAILED with an `updateMany` of its own and so never refunded — the preview
    // defect that took eight credits and kept them.
    jobFindUniqueMock.mockImplementation(async (args) =>
      isRefundLookup(args) ? refundableRow() : null,
    );
    jobUpdateManyMock.mockResolvedValue({ count: 1 });

    await failImageJob(
      "job-1",
      "provider_error",
      "Unexpected status code: 422",
    );

    const written = jobUpdateManyMock.mock.calls[0]![0].data;
    expect(written.status).toBe("FAILED");
    expect(written.failureReason).toBe("provider_error");
    // A sentence, not the provider's transport string. "Unexpected status code:
    // 422" reached a person's screen; it now only reaches the log.
    expect(written.error).toBe(
      "The image provider could not finish this image.",
    );
    expect(written.error).not.toContain("422");
    // And the money came back.
    const refund = jobUpdateMock.mock.calls.find(
      (call) => call[0].data?.refundTransaction,
    );
    expect(refund).toBeDefined();
  });

  it("refunds a generation whose model left the catalog before it was sent", async () => {
    // Newly reachable now that the catalog is live: a model fal withdraws between
    // reservation and submission makes `buildFalInput` throw. That used to escape
    // as a 500 and leave the row SUBMITTING with the charge taken, which the
    // sweeper then called SUBMISSION_UNCERTAIN — a status deliberately never
    // refunded. The person paid for a request that was never sent.
    const withdrawn = jobRow({ model: "fal-ai/withdrawn-last-year" });
    jobCreateMock.mockResolvedValue(withdrawn);
    jobFindUniqueOrThrowMock.mockResolvedValue(withdrawn);
    jobFindUniqueMock.mockImplementation(async (args) =>
      isRefundLookup(args) ? refundableRow() : null,
    );

    const job = await createImageJob(BASE_INPUT);

    // Never sent: the failure happened before `submitToQueue`.
    expect(submitToQueueMock).not.toHaveBeenCalled();
    expect(job.status).toBe("FAILED");
    const written = jobUpdateMock.mock.calls[0]![0].data;
    expect(written.failureReason).toBe("request_not_supported");
    expect(written.error).toBe(
      "This model, or these settings, are no longer available from the image provider.",
    );
    const refund = jobUpdateMock.mock.calls.find(
      (call) => call[0].data?.refundTransaction,
    );
    expect(refund).toBeDefined();
  });

  it("tells the person a sentence when the provider refuses a submission", async () => {
    submitToQueueMock.mockResolvedValue({
      kind: "rejected",
      status: 422,
      message: '{"detail":"Unexpected status code: 422"}',
    });
    jobFindUniqueMock.mockImplementation(async (args) =>
      isRefundLookup(args) ? refundableRow() : null,
    );

    await createImageJob(BASE_INPUT);

    const written = jobUpdateMock.mock.calls[0]![0].data;
    expect(written.failureReason).toBe("provider_rejected");
    expect(written.error).toBe("The image provider refused this request.");
    expect(written.error).not.toContain("422");
  });

  it("sweeps up a charge whose inline refund never got written", async () => {
    jobFindManyMock.mockResolvedValue([{ id: "job-1" }]);
    jobFindUniqueMock.mockImplementation(async (args) =>
      isRefundLookup(args) ? refundableRow() : null,
    );

    expect(await refundFailedImageJobs(50)).toBe(1);
    const selection = jobFindManyMock.mock.calls[0]![0].where;
    expect(selection.refundTransactionId).toBeNull();
    expect(selection.status.in).toEqual(["FAILED", "CANCELED", "ORPHANED"]);
  });
});
