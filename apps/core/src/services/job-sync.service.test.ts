import {
  AgentJobStatus,
  AgentStatus,
  JobType,
  NotificationKind,
} from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PURCHASE_DIFF_SYNC_METADATA_KEY } from "./job-purchase-diff.service";
import { jobSyncService } from "./job-sync.service";

const {
  captureExceptionMock,
  captureMessageMock,
  setExtrasMock,
  withScopeMock,
  createJobEventForJobIdMock,
  createNotificationMock,
  createJobPurchaseMock,
  fetchAgentJobStatusMock,
  getJobByIdMock,
  getLatestJobEventByJobIdMock,
  publishJobStatusDataMock,
  prismaJobFindManyMock,
  renderJobFailureNotificationEmailMock,
  renderJobFinalStatusEmailMock,
  renderJobInputRequiredEmailMock,
  requestFetchMock,
  sendEmailMock,
  sendEmailsMock,
  sourceImportEnqueueMock,
  paymentClientFactoryMock,
  getPurchaseByBlockchainIdentifierMock,
  getPurchasesDiffMock,
  jobPurchaseFindManyMock,
  syncMetadataFindUniqueMock,
  syncMetadataUpdateManyMock,
  syncMetadataUpsertMock,
  updateJobPurchaseByJobIdMock,
  refundJobMock,
  prismaTransactionMock,
} = vi.hoisted(() => {
  const setExtrasMock = vi.fn();
  const withScopeMock = vi.fn((callback: (scope: unknown) => void) => {
    callback({ setExtras: setExtrasMock });
  });
  return {
    captureExceptionMock: vi.fn(),
    captureMessageMock: vi.fn(),
    setExtrasMock,
    withScopeMock,
    createJobEventForJobIdMock: vi.fn(),
    createNotificationMock: vi.fn(),
    createJobPurchaseMock: vi.fn(),
    fetchAgentJobStatusMock: vi.fn(),
    getJobByIdMock: vi.fn(),
    getLatestJobEventByJobIdMock: vi.fn(),
    publishJobStatusDataMock: vi.fn(),
    prismaJobFindManyMock: vi.fn(),
    renderJobFailureNotificationEmailMock: vi.fn(),
    renderJobFinalStatusEmailMock: vi.fn(),
    renderJobInputRequiredEmailMock: vi.fn(),
    requestFetchMock: vi.fn(),
    sendEmailMock: vi.fn(),
    sendEmailsMock: vi.fn(),
    sourceImportEnqueueMock: vi.fn(),
    paymentClientFactoryMock: vi.fn(),
    getPurchaseByBlockchainIdentifierMock: vi.fn(),
    getPurchasesDiffMock: vi.fn(),
    jobPurchaseFindManyMock: vi.fn(),
    syncMetadataFindUniqueMock: vi.fn(),
    syncMetadataUpdateManyMock: vi.fn(),
    syncMetadataUpsertMock: vi.fn(),
    updateJobPurchaseByJobIdMock: vi.fn(),
    refundJobMock: vi.fn(),
    prismaTransactionMock: vi.fn(),
  };
});

vi.mock("@vercel/related-projects", () => ({
  withRelatedProject: (opts: { defaultHost: string }) => opts.defaultHost,
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
  captureMessage: captureMessageMock,
  withScope: withScopeMock,
}));

vi.mock("@sokosumi/database/helpers", async () => {
  const actual = await vi.importActual<
    typeof import("@sokosumi/database/helpers")
  >("@sokosumi/database/helpers");

  return {
    ...actual,
    mapJobWithStatus: (job: unknown) => job,
  };
});

vi.mock("@/services/job-refund", () => ({
  refundJob: refundJobMock,
}));

vi.mock("@sokosumi/database/repositories", () => ({
  jobEventRepository: {
    createJobEventForJobId: createJobEventForJobIdMock,
    getLatestJobEventByJobId: getLatestJobEventByJobIdMock,
  },
  jobPurchaseRepository: {
    createJobPurchase: createJobPurchaseMock,
    updateJobPurchaseByJobId: updateJobPurchaseByJobIdMock,
  },
  jobRepository: {
    getJobById: getJobByIdMock,
  },
}));

vi.mock("@sokosumi/masumi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/masumi")>()),
  createAgentClient: () => ({
    fetchAgentJobStatus: fetchAgentJobStatusMock,
  }),
}));

vi.mock("@/clients/masumi-payment.client", () => ({
  paymentClient: paymentClientFactoryMock,
}));

vi.mock("@/clients/email.client", () => ({
  sendEmail: sendEmailMock,
  sendEmails: sendEmailsMock,
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    WEB_APP_BASE_URL: "https://app.sokosumi.test",
    JOB_FAILURE_NOTIFICATION_EMAILS: [
      "stakeholder1@example.com",
      "stakeholder2@example.com",
    ],
    JOB_FAILURE_WEBHOOK_URL: "https://hooks.example.com/job-failure",
    NETWORK: "Preprod",
    RESEND_FROM_EMAIL: "no-reply@example.com",
  }),
  getWebAppBaseUrl: () => "https://app.sokosumi.test",
}));

vi.mock("@/helpers/purchase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/purchase")>()),
  transformPurchaseToJobUpdate: (purchase: {
    CurrentTransaction?: {
      status: string;
      txHash?: string | null;
    } | null;
    id: string;
    nextAction?: string | null;
    nextActionErrorNote?: string | null;
    nextActionErrorType?: string | null;
    onChainStatus?: string | null;
    resultHash?: string | null;
  }) => ({
    externalId: purchase.id,
    onChainStatus: purchase.onChainStatus ?? null,
    resultHash: purchase.resultHash ?? null,
    nextAction: purchase.nextAction ?? "NONE",
    nextActionErrorType: purchase.nextActionErrorType ?? null,
    nextActionErrorNote: purchase.nextActionErrorNote ?? null,
    ...(purchase.CurrentTransaction
      ? {
          onChainTransactionHash:
            purchase.CurrentTransaction.txHash ?? undefined,
          onChainTransactionStatus:
            purchase.CurrentTransaction.status === "Confirmed"
              ? "COMPLETED"
              : "PENDING",
        }
      : {}),
  }),
}));

vi.mock("@/lib/ably/publish", () => ({
  publishJobStatusData: publishJobStatusDataMock,
}));

vi.mock("@/helpers/notifications", () => ({
  createNotification: createNotificationMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    job: {
      findMany: prismaJobFindManyMock,
    },
    jobPurchase: {
      findMany: jobPurchaseFindManyMock,
    },
    syncMetadata: {
      findUnique: syncMetadataFindUniqueMock,
      updateMany: syncMetadataUpdateManyMock,
      upsert: syncMetadataUpsertMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@/services/source-import.service", () => ({
  sourceImportService: {
    enqueueFromMarkdown: sourceImportEnqueueMock,
  },
}));

vi.mock("@sokosumi/email", () => ({
  renderJobFailureNotificationEmail: renderJobFailureNotificationEmailMock,
  renderJobFinalStatusEmail: renderJobFinalStatusEmailMock,
  renderJobInputRequiredEmail: renderJobInputRequiredEmailMock,
}));

const originalFetch = global.fetch;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

function createJobEvent(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "event_1",
    status: AgentJobStatus.RUNNING,
    result: null,
    statusHash: "old-hash",
    input: null,
    createdAt: new Date("2026-03-18T10:00:00.000Z"),
    ...overrides,
  };
}

function createJob(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = new Date();
  const events = (overrides.events as
    | Record<string, unknown>[]
    | undefined) ?? [createJobEvent()];

  return {
    id: "job_1",
    agentId: "agent_1",
    agentJobId: "remote-job-1",
    ownerId: "user_1",
    jobType: JobType.PAID,
    refundedTransactionId: null,
    blockchainIdentifier: "blockchain-job-1",
    agentBlockchainIdentifier: null,
    agentApiBaseUrl: null,
    purchase: {
      externalId: "purchase_1",
      onChainStatus: null,
      resultHash: null,
      nextAction: "NONE",
      nextActionErrorType: null,
      nextActionErrorNote: null,
    },
    events,
    agent: {
      id: "agent_1",
      name: "Planner",
      blockchainIdentifier: "agent-chain-1",
      apiBaseUrl: "https://agent.example.com",
      authorContactEmail: null,
    },
    owner: {
      id: "user_1",
      email: "user@example.com",
      name: "Ada",
      notificationsOptIn: true,
    },
    payByTime: new Date(now.getTime() + 30 * 60 * 1000),
    submitResultTime: new Date(now.getTime() + 40 * 60 * 1000),
    unlockTime: new Date(now.getTime() + 50 * 60 * 1000),
    externalDisputeUnlockTime: new Date(now.getTime() + 60 * 60 * 1000),
    input: JSON.stringify({ prompt: "hello" }),
    inputHash: "job-input-hash",
    paymentSourceType: null,
    purchaseAmounts: [{ unit: "lovelace", amount: "1000000" }],
    purchaseAmountMatchRequired: true,
    sellerVkey: "seller-vkey-1",
    completedAt: null,
    status: SokosumiJobStatus.PROCESSING,
    jobStatusSettled: false,
    workspaceId: "11111111-1111-7111-8111-111111111111",
    ...overrides,
  };
}

function matchingResolvedPurchase(
  job: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const agent = job.agent as { blockchainIdentifier?: string } | undefined;
  const inputData = JSON.parse(job.input as string);
  return {
    blockchainIdentifier: job.blockchainIdentifier,
    inputHash: job.inputHash,
    agentIdentifier:
      job.agentBlockchainIdentifier ?? agent?.blockchainIdentifier ?? null,
    payByTime:
      job.payByTime === null ? null : String((job.payByTime as Date).getTime()),
    submitResultTime: String((job.submitResultTime as Date).getTime()),
    unlockTime: String((job.unlockTime as Date).getTime()),
    externalDisputeUnlockTime: String(
      (job.externalDisputeUnlockTime as Date).getTime(),
    ),
    PaidFunds: job.purchaseAmounts,
    PaymentSource: { paymentSourceType: "Web3CardanoV1" },
    SellerWallet: {
      id: "seller_wallet_1",
      walletVkey: job.sellerVkey,
    },
    SmartContractWallet: null,
    metadata: JSON.stringify({ inputData, jobId: job.agentJobId }),
    ...overrides,
  };
}

/**
 * Seeds one changed purchase on the diff feed and joins it to `job` through
 * `JobPurchase.externalId`, the id join the payment node and our own row share.
 */
function mockPurchaseDiff(
  job: Record<string, unknown>,
  purchase: Record<string, unknown>,
): void {
  const jobPurchase = job.purchase as { externalId?: string } | undefined;
  const externalId =
    (purchase.id as string | undefined) ??
    jobPurchase?.externalId ??
    "purchase_1";
  getPurchasesDiffMock.mockResolvedValueOnce(
    ok([
      {
        blockchainIdentifier: job.blockchainIdentifier,
        nextActionOrOnChainStateOrResultLastChangedAt: new Date(
          "2026-03-18T10:05:00.000Z",
        ),
        ...purchase,
        id: externalId,
      },
    ]),
  );
  jobPurchaseFindManyMock.mockResolvedValue([{ externalId, job }]);
}

function createExecutionOptions(
  overrides: Partial<{
    abortSignal: AbortSignal;
    deadlineMs: number;
    shouldContinue: () => boolean;
  }> = {},
) {
  return {
    abortSignal: new AbortController().signal,
    deadlineMs: Date.now() + 60_000,
    shouldContinue: () => true,
    ...overrides,
  };
}

function mockInitialJobQueries({
  purchase = [],
  purchaseTransaction = [],
  agent,
  pendingLocalRefunds = [],
  unfinished,
}: {
  purchase?: Record<string, unknown>[];
  purchaseTransaction?: Record<string, unknown>[];
  agent?: Record<string, unknown>[];
  pendingLocalRefunds?: Record<string, unknown>[];
  unfinished?: Record<string, unknown>[];
} = {}) {
  prismaJobFindManyMock.mockReset();
  prismaJobFindManyMock.mockResolvedValueOnce(purchase);
  prismaJobFindManyMock.mockResolvedValueOnce(purchaseTransaction);
  prismaJobFindManyMock.mockResolvedValueOnce(agent ?? unfinished ?? []);
  prismaJobFindManyMock.mockResolvedValueOnce(pendingLocalRefunds);
}

describe("jobSyncService.syncUnfinishedJobs", () => {
  beforeEach(() => {
    for (const mock of [
      captureExceptionMock,
      captureMessageMock,
      setExtrasMock,
      withScopeMock,
      createJobEventForJobIdMock,
      createNotificationMock,
      createJobPurchaseMock,
      fetchAgentJobStatusMock,
      getJobByIdMock,
      getLatestJobEventByJobIdMock,
      publishJobStatusDataMock,
      prismaJobFindManyMock,
      renderJobFailureNotificationEmailMock,
      renderJobFinalStatusEmailMock,
      renderJobInputRequiredEmailMock,
      requestFetchMock,
      sendEmailMock,
      sendEmailsMock,
      sourceImportEnqueueMock,
      paymentClientFactoryMock,
      getPurchaseByBlockchainIdentifierMock,
      getPurchasesDiffMock,
      jobPurchaseFindManyMock,
      syncMetadataFindUniqueMock,
      syncMetadataUpdateManyMock,
      syncMetadataUpsertMock,
      updateJobPurchaseByJobIdMock,
      refundJobMock,
      prismaTransactionMock,
    ]) {
      mock.mockReset();
    }
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    paymentClientFactoryMock.mockReturnValue({
      getPurchaseByBlockchainIdentifier: getPurchaseByBlockchainIdentifierMock,
      getPurchasesDiff: getPurchasesDiffMock,
    });
    getPurchasesDiffMock.mockResolvedValue(ok([]));
    jobPurchaseFindManyMock.mockResolvedValue([]);
    syncMetadataFindUniqueMock.mockResolvedValue(null);
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({});
    });
    mockInitialJobQueries();
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(err("not found"));
    fetchAgentJobStatusMock.mockReturnValue(err("not found"));
    getLatestJobEventByJobIdMock.mockResolvedValue(createJobEvent());
    createJobEventForJobIdMock.mockResolvedValue({ id: "event_2" });
    getJobByIdMock.mockResolvedValue(createJob());
    renderJobFailureNotificationEmailMock.mockResolvedValue({
      subject: "failure",
      html: "<p>failure</p>",
    });
    renderJobFinalStatusEmailMock.mockResolvedValue({
      subject: "completed",
      html: "<p>completed</p>",
    });
    renderJobInputRequiredEmailMock.mockResolvedValue({
      subject: "input",
      html: "<p>input</p>",
    });
    sendEmailMock.mockResolvedValue(undefined);
    sendEmailsMock.mockImplementation(async (emails: unknown[]) => {
      const results = [];
      for (const email of emails) {
        results.push(await sendEmailMock(email));
      }
      return results;
    });
    publishJobStatusDataMock.mockResolvedValue(undefined);
    sourceImportEnqueueMock.mockResolvedValue(undefined);
    refundJobMock.mockResolvedValue(undefined);
    createJobPurchaseMock.mockResolvedValue(undefined);
    createNotificationMock.mockResolvedValue({
      notification: { id: "notif_1" },
      created: true,
    });
    updateJobPurchaseByJobIdMock.mockResolvedValue(undefined);
    global.fetch = requestFetchMock as unknown as typeof fetch;
    requestFetchMock.mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    global.fetch = originalFetch;
  });

  it("backfills missing purchases and continues syncing in the same run", async () => {
    const backfilledJob = createJob({
      agentBlockchainIdentifier: "agent-chain-at-start",
      agentApiBaseUrl: "https://agent-at-start.example.com",
      purchase: {
        id: "purchase_1",
        externalId: "purchase_backfilled",
        onChainStatus: null,
        onChainTransactionHash: null,
        onChainTransactionStatus: null,
        resultHash: "result-hash",
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
        createdAt: new Date("2026-03-18T10:00:00.000Z"),
        updatedAt: new Date("2026-03-18T10:01:00.000Z"),
        jobId: "job_1",
        errorNote: null,
        errorNoteKey: null,
      },
      status: SokosumiJobStatus.PAYMENT_PENDING,
    });
    const pendingBackfillJob = createJob({
      purchase: null,
      status: SokosumiJobStatus.PAYMENT_PENDING,
    });
    mockInitialJobQueries({
      purchase: [pendingBackfillJob],
      agent: [backfilledJob],
    });
    // The resolved purchase echoes the job's own seller-signed terms — the
    // backfill guard refuses anything else.
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok(
        matchingResolvedPurchase(pendingBackfillJob, {
          id: "purchase_backfilled",
          resultHash: "result-hash",
        }),
      ),
    );
    getJobByIdMock.mockResolvedValueOnce(backfilledJob);

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result.unfinishedFound).toBe(1);
    expect(result.processed).toBe(2);
    expect(createJobPurchaseMock).toHaveBeenCalledWith(
      {
        jobId: "job_1",
        externalId: "purchase_backfilled",
        onChainStatus: null,
        resultHash: "result-hash",
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      },
      expect.any(Object),
    );
    expect(getPurchaseByBlockchainIdentifierMock).toHaveBeenCalledWith(
      "blockchain-job-1",
      expect.objectContaining({
        signal: expect.any(Object),
      }),
    );
    expect(getPurchaseByBlockchainIdentifierMock).toHaveBeenCalledTimes(1);
    expect(getJobByIdMock).toHaveBeenCalledWith("job_1", expect.any(Object));
    expect(fetchAgentJobStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "agent_1",
        blockchainIdentifier: "agent-chain-at-start",
        apiBaseUrl: "https://agent-at-start.example.com",
        metadataOverride: null,
      }),
      backfilledJob.agentJobId,
      expect.objectContaining({
        signal: expect.any(Object),
      }),
    );
  });

  it("reconciles refund-withdrawn jobs without running the standard sync pipeline", async () => {
    const reconciliationJob = createJob({
      id: "job_refund",
      status: SokosumiJobStatus.REFUND_RESOLVED,
      purchase: {
        externalId: "purchase_refund",
        onChainStatus: "REFUND_WITHDRAWN",
        resultHash: null,
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      },
    });
    mockInitialJobQueries({
      pendingLocalRefunds: [reconciliationJob],
    });
    getJobByIdMock.mockResolvedValueOnce(reconciliationJob);

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        processed: 1,
        unfinishedFound: 1,
      }),
    );
    expect(refundJobMock).toHaveBeenCalledWith("job_refund", {});
    expect(fetchAgentJobStatusMock).not.toHaveBeenCalled();
    expect(getPurchaseByBlockchainIdentifierMock).not.toHaveBeenCalled();
    expect(createJobEventForJobIdMock).not.toHaveBeenCalled();
    expect(sourceImportEnqueueMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(publishJobStatusDataMock).not.toHaveBeenCalled();
  });

  it("logs separate counts for standard sync and refund reconciliation", async () => {
    const reconciliationJob = createJob({
      id: "job_refund",
      status: SokosumiJobStatus.REFUND_RESOLVED,
      purchase: {
        externalId: "purchase_refund",
        onChainStatus: "REFUND_WITHDRAWN",
        resultHash: null,
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      },
    });
    mockInitialJobQueries({
      purchase: [createJob()],
      agent: [createJob()],
      pendingLocalRefunds: [reconciliationJob],
    });
    getJobByIdMock
      .mockResolvedValueOnce(createJob())
      .mockResolvedValueOnce(reconciliationJob);

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[sync/jobs/purchase-backfill] Found 1 jobs needing a purchase backfill",
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[sync/jobs/agent] Found 1 jobs for agent sync",
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[sync/jobs/refund] Found 1 jobs pending local refund",
    );
  });

  it("reconciles purchase-state payment failures without running the standard sync pipeline", async () => {
    const reconciliationJob = createJob({
      id: "job_payment_failed",
      status: SokosumiJobStatus.PAYMENT_FAILED,
      purchase: {
        externalId: "purchase_payment_failed",
        onChainStatus: "FUNDS_OR_DATUM_INVALID",
        resultHash: null,
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      },
    });
    mockInitialJobQueries({
      pendingLocalRefunds: [reconciliationJob],
    });
    getJobByIdMock.mockResolvedValueOnce(reconciliationJob);

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        processed: 1,
        unfinishedFound: 1,
      }),
    );
    expect(refundJobMock).toHaveBeenCalledWith("job_payment_failed", {});
    expect(fetchAgentJobStatusMock).not.toHaveBeenCalled();
    expect(getPurchaseByBlockchainIdentifierMock).not.toHaveBeenCalled();
    expect(createJobEventForJobIdMock).not.toHaveBeenCalled();
    expect(sourceImportEnqueueMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(publishJobStatusDataMock).not.toHaveBeenCalled();
  });

  it("reconciles purchase-action payment failures without running the standard sync pipeline", async () => {
    const reconciliationJob = createJob({
      id: "job_purchase_action_failed",
      status: SokosumiJobStatus.PAYMENT_FAILED,
      purchase: {
        externalId: "purchase_action_failed",
        onChainStatus: null,
        resultHash: null,
        nextAction: "FUNDS_LOCKING_REQUESTED",
        nextActionErrorType: "NETWORK_ERROR",
        nextActionErrorNote: null,
      },
    });
    mockInitialJobQueries({
      pendingLocalRefunds: [reconciliationJob],
    });
    getJobByIdMock.mockResolvedValueOnce(reconciliationJob);

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        processed: 1,
        unfinishedFound: 1,
      }),
    );
    expect(refundJobMock).toHaveBeenCalledWith(
      "job_purchase_action_failed",
      {},
    );
    expect(fetchAgentJobStatusMock).not.toHaveBeenCalled();
    expect(getPurchaseByBlockchainIdentifierMock).not.toHaveBeenCalled();
    expect(createJobEventForJobIdMock).not.toHaveBeenCalled();
    expect(sourceImportEnqueueMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(publishJobStatusDataMock).not.toHaveBeenCalled();
  });

  it("refuses to backfill a purchase that does not match the job's terms", async () => {
    const pendingJob = createJob({
      purchase: null,
      status: SokosumiJobStatus.PAYMENT_PENDING,
    });
    mockInitialJobQueries({ purchase: [pendingJob] });
    // Foreign purchase sharing the blockchainIdentifier: terms differ.
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok({
        id: "purchase_foreign",
        resultHash: null,
        inputHash: "foreign-input-hash",
        payByTime: "1700000000000",
        submitResultTime: "1700000000001",
        unlockTime: "1700000000002",
        externalDisputeUnlockTime: "1700000000003",
      }),
    );

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result.unfinishedFound).toBe(1);
    expect(createJobPurchaseMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Resolved purchase does not match job terms",
        ),
      }),
    );
  });

  it("refuses to write a diff purchase for a different blockchain identifier", async () => {
    // The externalId join says the row is ours, so a different identifier is
    // corruption on one side or the other. Writing it would stamp another
    // job's on-chain status — and therefore its refund or completion — here.
    mockInitialJobQueries({});
    mockPurchaseDiff(createJob(), {
      id: "purchase_1",
      blockchainIdentifier: "blockchain-job-2",
      onChainStatus: "REFUND_WITHDRAWN",
      nextAction: "NONE",
      nextActionErrorType: null,
      nextActionErrorNote: null,
    });

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(updateJobPurchaseByJobIdMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Diff purchase is for a different blockchain identifier than job job_1",
        ),
      }),
    );
  });

  it("accepts a diff purchase whose identifier differs only in casing", async () => {
    // Casing never carries meaning in these hex-encoded protocol values, so
    // an uppercase identifier is the same purchase, not a foreign one.
    mockInitialJobQueries({});
    mockPurchaseDiff(createJob(), {
      id: "purchase_1",
      blockchainIdentifier: "BLOCKCHAIN-JOB-1",
      onChainStatus: "FUNDS_LOCKED",
      nextAction: "NONE",
      nextActionErrorType: null,
      nextActionErrorNote: null,
    });

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(updateJobPurchaseByJobIdMock).toHaveBeenCalledWith(
      "job_1",
      // externalId rides along on purpose: when a job is found by its
      // blockchain identifier because the node replaced the purchase row,
      // this write is what repairs the stale id.
      expect.objectContaining({
        externalId: "purchase_1",
        onChainStatus: "FUNDS_LOCKED",
      }),
      {},
    );
    // The run report is what the cron logs, so diff work has to reach it.
    expect(result.processed).toBe(1);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("polls a purchase whose pending transaction can change outside the diff cursor", async () => {
    const pendingJob = createJob({
      purchase: {
        externalId: "purchase_1",
        onChainStatus: "FUNDS_LOCKED",
        resultHash: null,
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
        onChainTransactionHash: null,
        onChainTransactionStatus: "PENDING",
      },
    });
    mockInitialJobQueries({ purchaseTransaction: [pendingJob] });
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok(
        matchingResolvedPurchase(pendingJob, {
          id: "purchase_1",
          blockchainIdentifier: "blockchain-job-1",
          CurrentTransaction: {
            status: "Confirmed",
            txHash: "transaction-hash-1",
          },
        }),
      ),
    );

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(getPurchaseByBlockchainIdentifierMock).toHaveBeenCalledWith(
      "blockchain-job-1",
      { signal: expect.any(AbortSignal) },
    );
    expect(updateJobPurchaseByJobIdMock).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({
        onChainTransactionHash: "transaction-hash-1",
        onChainTransactionStatus: "COMPLETED",
      }),
      {},
    );
    expect(result.processed).toBe(1);
  });

  it("polls an attached legacy purchase without full term snapshots", async () => {
    const pendingJob = createJob({
      inputHash: null,
      payByTime: null,
      submitResultTime: null,
      unlockTime: null,
      externalDisputeUnlockTime: null,
      purchaseAmounts: null,
      purchaseAmountMatchRequired: false,
      sellerVkey: null,
      purchase: {
        externalId: "purchase_1",
        onChainStatus: "FUNDS_LOCKED",
        resultHash: null,
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
        onChainTransactionHash: null,
        onChainTransactionStatus: "PENDING",
      },
    });
    mockInitialJobQueries({ purchaseTransaction: [pendingJob] });
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok({
        id: "purchase_1",
        blockchainIdentifier: "blockchain-job-1",
        CurrentTransaction: {
          status: "Confirmed",
          txHash: "transaction-hash-1",
        },
      }),
    );

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(updateJobPurchaseByJobIdMock).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({
        onChainTransactionHash: "transaction-hash-1",
        onChainTransactionStatus: "COMPLETED",
      }),
      {},
    );
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("still writes a diff purchase that carries no blockchain identifier", async () => {
    // Legacy tolerance: rows predating the snapshot columns can arrive without
    // an identifier. The externalId join already proved ownership, so an
    // absent value reads as unverifiable, not as foreign — otherwise those
    // jobs would stop syncing and never reach a terminal state.
    mockInitialJobQueries({});
    mockPurchaseDiff(createJob(), {
      id: "purchase_1",
      blockchainIdentifier: null,
      onChainStatus: "FUNDS_LOCKED",
      nextAction: "NONE",
      nextActionErrorType: null,
      nextActionErrorNote: null,
    });

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(updateJobPurchaseByJobIdMock).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({ onChainStatus: "FUNDS_LOCKED" }),
      {},
    );
  });

  it("refuses to backfill a purchase signed for a different agent", async () => {
    const pendingJob = createJob({
      purchase: null,
      status: SokosumiJobStatus.PAYMENT_PENDING,
    });
    mockInitialJobQueries({ purchase: [pendingJob] });
    // Same identifier and same deadlines, but signed for another agent.
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok(
        matchingResolvedPurchase(pendingJob, {
          id: "purchase_other_agent",
          agentIdentifier: "agent-chain-someone-else",
        }),
      ),
    );

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(createJobPurchaseMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Resolved purchase does not match job terms",
        ),
      }),
    );
  });

  it("refuses to backfill a purchase charged at a different price", async () => {
    const pendingJob = createJob({
      purchase: null,
      status: SokosumiJobStatus.PAYMENT_PENDING,
    });
    mockInitialJobQueries({ purchase: [pendingJob] });
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok(
        matchingResolvedPurchase(pendingJob, {
          id: "purchase_wrong_price",
          PaidFunds: [{ unit: "lovelace", amount: "2000000" }],
        }),
      ),
    );

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(createJobPurchaseMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Resolved purchase does not match job terms",
        ),
      }),
    );
  });

  it("refuses to backfill a purchase belonging to a different seller", async () => {
    const pendingJob = createJob({
      purchase: null,
      status: SokosumiJobStatus.PAYMENT_PENDING,
    });
    mockInitialJobQueries({ purchase: [pendingJob] });
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok(
        matchingResolvedPurchase(pendingJob, {
          id: "purchase_wrong_seller",
          SellerWallet: {
            id: "seller_wallet_other",
            walletVkey: "different-seller-vkey",
          },
        }),
      ),
    );

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(createJobPurchaseMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Resolved purchase does not match job terms",
        ),
      }),
    );
  });

  it("refuses to backfill a purchase with different metadata", async () => {
    const pendingJob = createJob({
      purchase: null,
      status: SokosumiJobStatus.PAYMENT_PENDING,
    });
    mockInitialJobQueries({ purchase: [pendingJob] });
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok(
        matchingResolvedPurchase(pendingJob, {
          id: "purchase_wrong_metadata",
          metadata: JSON.stringify({
            inputData: { prompt: "different" },
            jobId: pendingJob.agentJobId,
          }),
        }),
      ),
    );

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(createJobPurchaseMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Resolved purchase does not match job terms",
        ),
      }),
    );
  });

  it("backfills a legacy job without a purchase amount snapshot", async () => {
    const pendingJob = createJob({
      purchase: null,
      purchaseAmounts: null,
      purchaseAmountMatchRequired: false,
      status: SokosumiJobStatus.PAYMENT_PENDING,
    });
    mockInitialJobQueries({ purchase: [pendingJob] });
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok(matchingResolvedPurchase(pendingJob, { id: "purchase_unverifiable" })),
    );

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(createJobPurchaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job_1",
        externalId: "purchase_unverifiable",
      }),
      expect.any(Object),
    );
  });

  it("refuses to backfill a new job missing its required amount snapshot", async () => {
    const pendingJob = createJob({
      purchase: null,
      purchaseAmounts: null,
      status: SokosumiJobStatus.PAYMENT_PENDING,
    });
    mockInitialJobQueries({ purchase: [pendingJob] });
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok(matchingResolvedPurchase(pendingJob, { id: "purchase_unverifiable" })),
    );

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(createJobPurchaseMock).not.toHaveBeenCalled();
  });

  it("refuses to backfill a purchase settled through the other rail", async () => {
    const pendingJob = createJob({
      purchase: null,
      status: SokosumiJobStatus.PAYMENT_PENDING,
      paymentSourceType: "Web3CardanoV2",
    });
    mockInitialJobQueries({ purchase: [pendingJob] });
    // Everything matches except the contract it settles through.
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok(
        matchingResolvedPurchase(pendingJob, {
          id: "purchase_wrong_rail",
          PaymentSource: { paymentSourceType: "Web3CardanoV1" },
        }),
      ),
    );

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(createJobPurchaseMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Resolved purchase does not match job terms",
        ),
      }),
    );
  });

  it("refuses to backfill an untyped purchase for an explicitly-railed job", async () => {
    const pendingJob = createJob({
      purchase: null,
      status: SokosumiJobStatus.PAYMENT_PENDING,
      paymentSourceType: "Web3CardanoV2",
    });
    mockInitialJobQueries({ purchase: [pendingJob] });
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok(
        matchingResolvedPurchase(pendingJob, {
          id: "purchase_missing_rail",
          PaymentSource: null,
        }),
      ),
    );

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(createJobPurchaseMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Resolved purchase does not match job terms",
        ),
      }),
    );
  });

  it("refuses to backfill a legacy job with a missing deadline instead of throwing", async () => {
    // The purchase selector deliberately admits legacy paid jobs with a null
    // payByTime. Terms that cannot be verified must be refused, not crash.
    const pendingJob = createJob({
      purchase: null,
      status: SokosumiJobStatus.PAYMENT_PENDING,
      payByTime: null,
    });
    mockInitialJobQueries({ purchase: [pendingJob] });
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok(
        matchingResolvedPurchase(pendingJob, {
          id: "purchase_legacy",
          payByTime: "1700000000000",
        }),
      ),
    );

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(createJobPurchaseMock).not.toHaveBeenCalled();
    // Assert the REFUSAL, not merely the absence of a write: the phase runner
    // swallows thrown errors, so a TypeError from .getTime() on a null
    // deadline would otherwise satisfy this test too.
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Resolved purchase does not match job terms",
        ),
      }),
    );
  });

  it("refuses to backfill when the job has no input hash to match on", async () => {
    const pendingJob = createJob({
      purchase: null,
      status: SokosumiJobStatus.PAYMENT_PENDING,
      inputHash: null,
    });
    mockInitialJobQueries({ purchase: [pendingJob] });
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok(
        matchingResolvedPurchase(pendingJob, {
          id: "purchase_unverifiable",
          inputHash: "some-hash",
        }),
      ),
    );

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    // A missing hash is never a wildcard.
    expect(createJobPurchaseMock).not.toHaveBeenCalled();
  });

  it("backfills when the node echoes the input hash in a different case", async () => {
    // The hash crosses a boundary we do not control: we send one spelling, the
    // node stores and echoes whatever it likes. Every sibling term in this
    // conjunction already compares case-insensitively, and a false mismatch
    // here refuses to attach a real purchase to its job — leaving a funded
    // escrow that the local refund path can compensate a second time.
    const pendingJob = createJob({
      purchase: null,
      status: SokosumiJobStatus.PAYMENT_PENDING,
      inputHash: "abcdef0123456789",
    });
    mockInitialJobQueries({ purchase: [pendingJob] });
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok(
        matchingResolvedPurchase(pendingJob, {
          id: "purchase_uppercase_hash",
          inputHash: "ABCDEF0123456789",
        }),
      ),
    );

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(createJobPurchaseMock).toHaveBeenCalledTimes(1);
  });

  it("reconciles timed-out missing purchases without running the standard sync pipeline", async () => {
    const reconciliationJob = createJob({
      id: "job_missing_purchase",
      status: SokosumiJobStatus.PAYMENT_FAILED,
      purchase: null,
      payByTime: new Date("2026-03-18T09:45:00.000Z"),
    });
    mockInitialJobQueries({
      pendingLocalRefunds: [reconciliationJob],
    });
    getJobByIdMock.mockResolvedValueOnce(reconciliationJob);

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        processed: 1,
        unfinishedFound: 1,
      }),
    );
    expect(refundJobMock).toHaveBeenCalledWith("job_missing_purchase", {});
    expect(getPurchaseByBlockchainIdentifierMock).not.toHaveBeenCalled();
    expect(fetchAgentJobStatusMock).not.toHaveBeenCalled();
    expect(createJobEventForJobIdMock).not.toHaveBeenCalled();
    expect(sourceImportEnqueueMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(publishJobStatusDataMock).not.toHaveBeenCalled();
  });

  it("reconciles timed-out missing purchases with null payByTime using createdAt fallback", async () => {
    const reconciliationJob = createJob({
      id: "job_null_payby_fallback",
      status: SokosumiJobStatus.PAYMENT_FAILED,
      purchase: null,
      payByTime: null,
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    mockInitialJobQueries({
      pendingLocalRefunds: [reconciliationJob],
    });
    getJobByIdMock.mockResolvedValueOnce(reconciliationJob);

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        processed: 1,
        unfinishedFound: 1,
      }),
    );
    expect(refundJobMock).toHaveBeenCalledWith("job_null_payby_fallback", {});
    expect(getPurchaseByBlockchainIdentifierMock).not.toHaveBeenCalled();
    expect(fetchAgentJobStatusMock).not.toHaveBeenCalled();
  });

  it("reconciles timed-out null-on-chain purchases without running the standard sync pipeline", async () => {
    const reconciliationJob = createJob({
      id: "job_null_on_chain",
      status: SokosumiJobStatus.PAYMENT_FAILED,
      payByTime: new Date("2026-03-18T09:45:00.000Z"),
      purchase: {
        externalId: "purchase_null_on_chain",
        onChainStatus: null,
        resultHash: null,
        nextAction: "NONE",
        nextActionErrorType: "NETWORK_ERROR",
        nextActionErrorNote: null,
      },
    });
    mockInitialJobQueries({
      pendingLocalRefunds: [reconciliationJob],
    });
    getJobByIdMock.mockResolvedValueOnce(reconciliationJob);

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        processed: 1,
        unfinishedFound: 1,
      }),
    );
    expect(refundJobMock).toHaveBeenCalledWith("job_null_on_chain", {});
    expect(getPurchaseByBlockchainIdentifierMock).not.toHaveBeenCalled();
    expect(fetchAgentJobStatusMock).not.toHaveBeenCalled();
    expect(createJobEventForJobIdMock).not.toHaveBeenCalled();
    expect(sourceImportEnqueueMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(publishJobStatusDataMock).not.toHaveBeenCalled();
  });

  it("reconciles refunds whenever the refund phase query includes the job", async () => {
    mockInitialJobQueries({
      pendingLocalRefunds: [
        createJob({
          id: "job_stale_reconciliation",
          status: SokosumiJobStatus.PAYMENT_FAILED,
          payByTime: new Date("2026-03-18T09:45:00.000Z"),
          purchase: {
            externalId: "purchase_stale_reconciliation",
            onChainStatus: null,
            resultHash: null,
            nextAction: "NONE",
            nextActionErrorType: null,
            nextActionErrorNote: null,
          },
        }),
      ],
    });
    getJobByIdMock.mockResolvedValueOnce(
      createJob({
        id: "job_stale_reconciliation",
        status: SokosumiJobStatus.REFUND_PENDING,
        payByTime: new Date("2026-03-18T09:45:00.000Z"),
        purchase: {
          externalId: "purchase_stale_reconciliation",
          onChainStatus: null,
          resultHash: null,
          nextAction: "SET_REFUND_REQUESTED_REQUESTED",
          nextActionErrorType: null,
          nextActionErrorNote: null,
        },
      }),
    );

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        processed: 1,
        unfinishedFound: 1,
      }),
    );
    expect(refundJobMock).toHaveBeenCalledWith("job_stale_reconciliation", {});
    expect(fetchAgentJobStatusMock).not.toHaveBeenCalled();
    expect(getPurchaseByBlockchainIdentifierMock).not.toHaveBeenCalled();
    expect(createJobEventForJobIdMock).not.toHaveBeenCalled();
    expect(sourceImportEnqueueMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(publishJobStatusDataMock).not.toHaveBeenCalled();
  });

  it("still reconciles refunds when the agent phase has no budget left", async () => {
    // The agent phase runs against a deadline reduced by REFUND_PHASE_RESERVED_MS
    // (20s). With only 5s left in the run, the agent phase must get nothing and
    // the refund phase — which returns money to users — must still run.
    mockInitialJobQueries({
      agent: [
        createJob({
          id: "job_agent_would_poll",
          status: SokosumiJobStatus.PROCESSING,
        }),
      ],
      pendingLocalRefunds: [
        createJob({
          id: "job_needs_refund",
          status: SokosumiJobStatus.PAYMENT_FAILED,
          payByTime: new Date("2026-03-18T09:45:00.000Z"),
          purchase: {
            externalId: "purchase_needs_refund",
            onChainStatus: null,
            resultHash: null,
            nextAction: "NONE",
            nextActionErrorType: null,
            nextActionErrorNote: null,
          },
        }),
      ],
    });
    getJobByIdMock.mockResolvedValueOnce(
      createJob({
        id: "job_needs_refund",
        status: SokosumiJobStatus.REFUND_PENDING,
        payByTime: new Date("2026-03-18T09:45:00.000Z"),
        purchase: {
          externalId: "purchase_needs_refund",
          onChainStatus: null,
          resultHash: null,
          nextAction: "SET_REFUND_REQUESTED_REQUESTED",
          nextActionErrorType: null,
          nextActionErrorNote: null,
        },
      }),
    );

    await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions({ deadlineMs: Date.now() + 5_000 }),
    );

    expect(refundJobMock).toHaveBeenCalledWith("job_needs_refund", {});
    // Starved on purpose: the reserve is what buys the refund phase its budget.
    expect(fetchAgentJobStatusMock).not.toHaveBeenCalled();
  });

  it("still reconciles refunds when the earlier phases have no budget left", async () => {
    // Backfill and the diff are network-bound too, and both run BEFORE the
    // agent phase. Reserving only against the agent phase let a slow node
    // consume the whole run here and starve refunds anyway, which is exactly
    // when refunds matter most.
    mockInitialJobQueries({
      purchase: [
        createJob({
          id: "job_purchase_would_poll",
          status: SokosumiJobStatus.PAYMENT_PENDING,
          // The backfill selector only admits purchase-less jobs, so a job
          // with a purchase row would never reach the node and the assertion
          // below would hold for the wrong reason.
          purchase: null,
        }),
      ],
      pendingLocalRefunds: [
        createJob({
          id: "job_needs_refund",
          status: SokosumiJobStatus.PAYMENT_FAILED,
          payByTime: new Date("2026-03-18T09:45:00.000Z"),
          purchase: {
            externalId: "purchase_needs_refund",
            onChainStatus: null,
            resultHash: null,
            nextAction: "NONE",
            nextActionErrorType: null,
            nextActionErrorNote: null,
          },
        }),
      ],
    });
    getJobByIdMock.mockResolvedValueOnce(
      createJob({
        id: "job_needs_refund",
        status: SokosumiJobStatus.REFUND_PENDING,
        payByTime: new Date("2026-03-18T09:45:00.000Z"),
        purchase: {
          externalId: "purchase_needs_refund",
          onChainStatus: null,
          resultHash: null,
          nextAction: "SET_REFUND_REQUESTED_REQUESTED",
          nextActionErrorType: null,
          nextActionErrorNote: null,
        },
      }),
    );

    await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions({ deadlineMs: Date.now() + 5_000 }),
    );

    expect(refundJobMock).toHaveBeenCalledWith("job_needs_refund", {});
    expect(getPurchaseByBlockchainIdentifierMock).not.toHaveBeenCalled();
    expect(getPurchasesDiffMock).not.toHaveBeenCalled();
  });

  it("attaches missing purchases before draining the diff feed", async () => {
    // Order matters: the diff drains whatever the node changed, so letting it
    // run first can leave a purchase unattached past the grace window, and the
    // refund phase then returns credits for a funded escrow.
    const callOrder: string[] = [];
    mockInitialJobQueries({
      purchase: [
        createJob({
          id: "job_needs_backfill",
          status: SokosumiJobStatus.PAYMENT_PENDING,
          purchase: null,
        }),
      ],
    });
    getPurchaseByBlockchainIdentifierMock.mockImplementation(async () => {
      callOrder.push("backfill");
      return err("not found");
    });
    getPurchasesDiffMock.mockImplementation(async () => {
      callOrder.push("diff");
      return ok([]);
    });

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(callOrder).toEqual(["backfill", "diff"]);
  });

  it("replays the purchase feed when the run asks for a cursor reset", async () => {
    // Joins the two halves of ?replay=true: the route sets the flag and the
    // diff service drops the cursor. Neither test alone proves the escape
    // hatch works, and the 30-day first-run lookback depends on it.
    mockInitialJobQueries({});

    await jobSyncService.syncUnfinishedJobs({
      ...createExecutionOptions(),
      resetPurchaseCursor: true,
    });

    expect(syncMetadataUpsertMock).toHaveBeenCalledWith({
      where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
      create: {
        key: PURCHASE_DIFF_SYNC_METADATA_KEY,
        cursorId: null,
        lastSyncedAt: new Date(0),
      },
      update: { cursorId: null, lastSyncedAt: new Date(0) },
    });
    expect(getPurchasesDiffMock).toHaveBeenCalledWith(
      new Date(0),
      null,
      expect.any(Number),
      expect.anything(),
    );
  });

  it("still reconciles refunds when the purchase diff throws", async () => {
    const reconciliationJob = createJob({
      id: "job_missing_purchase",
      status: SokosumiJobStatus.PAYMENT_FAILED,
      purchase: null,
      payByTime: new Date("2026-03-18T09:45:00.000Z"),
    });
    mockInitialJobQueries({
      pendingLocalRefunds: [reconciliationJob],
    });
    getJobByIdMock.mockResolvedValueOnce(reconciliationJob);
    getPurchasesDiffMock.mockRejectedValueOnce(new Error("diff exploded"));

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    // An unexpected throw in the diff must not take the refund phase with it.
    expect(refundJobMock).toHaveBeenCalledWith("job_missing_purchase", {});
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it("skips new events and notifications when the agent status hash is unchanged", async () => {
    mockInitialJobQueries({
      unfinished: [createJob()],
    });
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "running",
        result: null,
        input_schema: null,
        statusHash: "old-hash",
      }),
    );

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result.processed).toBe(1);
    expect(createJobEventForJobIdMock).not.toHaveBeenCalled();
    expect(publishJobStatusDataMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("persists agent status for FREE jobs with no purchase past the payment grace window", async () => {
    const freeLongRunningJob = createJob({
      jobType: JobType.FREE,
      purchase: null,
      payByTime: null,
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    mockInitialJobQueries({
      unfinished: [freeLongRunningJob],
    });
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "completed",
        result: "done",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValue(freeLongRunningJob);

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(createJobEventForJobIdMock).toHaveBeenCalled();
  });

  it("does not sync agent status for jobs whose agent is not ONLINE", async () => {
    const offlineAgentJob = createJob({
      agent: {
        id: "agent_1",
        name: "Planner",
        blockchainIdentifier: "agent-chain-1",
        authorContactEmail: null,
        status: AgentStatus.OFFLINE,
      },
    });

    mockInitialJobQueries({
      agent: [offlineAgentJob],
      pendingLocalRefunds: [],
    });

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        unfinishedFound: 1,
      }),
    );
    expect(fetchAgentJobStatusMock).not.toHaveBeenCalled();
    expect(createJobEventForJobIdMock).not.toHaveBeenCalled();
  });

  it("skips agent-status sync for agents without any MIP-003 endpoint", async () => {
    const endpointlessAgentJob = createJob({
      agent: {
        id: "agent_1",
        name: "Planner",
        blockchainIdentifier: "agent-chain-1",
        apiBaseUrl: null,
        metadataOverride: null,
        authorContactEmail: null,
      },
    });

    mockInitialJobQueries({
      agent: [endpointlessAgentJob],
      pendingLocalRefunds: [],
    });

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        processed: 1,
        unfinishedFound: 1,
      }),
    );
    expect(fetchAgentJobStatusMock).not.toHaveBeenCalled();
    expect(createJobEventForJobIdMock).not.toHaveBeenCalled();
  });

  it("creates new job events, enqueues source imports, and sends final notifications", async () => {
    const initialJob = createJob();
    const completedJob = createJob({
      status: SokosumiJobStatus.COMPLETED,
      jobStatusSettled: true,
      completedAt: new Date("2026-03-18T10:05:00.000Z"),
      agent: {
        id: "agent_1",
        name: "Planner",
        metadataOverride: { name: "Display Name" },
        blockchainIdentifier: "agent-chain-1",
        authorContactEmail: null,
      },
      events: [
        createJobEvent({
          id: "event_2",
          status: AgentJobStatus.COMPLETED,
          result: "[result](https://example.com/report.pdf)",
          statusHash: "new-hash",
        }),
      ],
    });

    mockInitialJobQueries({
      agent: [initialJob],
    });
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "completed",
        result: "[result](https://example.com/report.pdf)",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValueOnce(completedJob);

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(createJobEventForJobIdMock).toHaveBeenCalledWith(
      "job_1",
      {
        status: AgentJobStatus.COMPLETED,
        inputSchema: undefined,
        result: "[result](https://example.com/report.pdf)",
        statusHash: "new-hash",
      },
      {},
    );
    expect(sourceImportEnqueueMock).toHaveBeenCalledWith(
      "event_2",
      "[result](https://example.com/report.pdf)",
    );
    expect(renderJobFinalStatusEmailMock).toHaveBeenCalledWith({
      recipientName: "Ada",
      agentName: "Display Name",
      jobLink: "https://app.sokosumi.test/agents/agent_1/jobs/job_1",
      jobName: undefined,
      jobStatus: SokosumiJobStatus.COMPLETED,
      locale: "en",
    });
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        tag: "job-final-status",
      }),
    );
    expect(publishJobStatusDataMock).toHaveBeenCalledWith({
      agentId: "agent_1",
      userId: "user_1",
      jobId: "job_1",
      jobStatus: SokosumiJobStatus.COMPLETED,
      jobStatusSettled: true,
    });
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith({
      userId: "user_1",
      kind: NotificationKind.JOB,
      referenceId: "job_1",
      eventId: "event_2",
      messageKey: "Notifications.Job.completed",
      messageParams: {
        agentName: "Display Name",
        jobName: "Untitled job",
      },
      metadata: {
        agentId: "agent_1",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
    });
  });

  it("emits failure notifications for terminal payment failures", async () => {
    const updatedFailedJob = createJob({
      status: SokosumiJobStatus.PAYMENT_FAILED,
      agent: {
        id: "agent_1",
        name: "Planner",
        metadataOverride: { name: "Display Name" },
        blockchainIdentifier: "agent-chain-1",
        authorContactEmail: "author@example.com",
      },
      events: [
        createJobEvent({
          id: "event_2",
          status: AgentJobStatus.FAILED,
          result: "boom",
          statusHash: "new-hash",
        }),
      ],
    });

    mockInitialJobQueries({
      agent: [createJob()],
    });
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "failed",
        result: "boom",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValueOnce(updatedFailedJob);

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(refundJobMock).not.toHaveBeenCalled();
    expect(renderJobFailureNotificationEmailMock).toHaveBeenCalledWith({
      network: "Preprod",
      agentId: "agent_1",
      agentBlockchainIdentifier: "agent-chain-1",
      agentName: "Display Name",
      jobId: "job_1",
      jobBlockchainIdentifier: "blockchain-job-1",
      onChainStatus: "N/A",
      agentStatus: SokosumiJobStatus.PAYMENT_FAILED,
      result: "boom",
      resultHash: "N/A",
      locale: "en",
    });
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["author@example.com"],
        bcc: ["stakeholder1@example.com", "stakeholder2@example.com"],
        tag: "job-failure-notification",
      }),
    );
    expect(requestFetchMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        kind: NotificationKind.JOB,
        referenceId: "job_1",
        eventId: "event_2",
        messageKey: "Notifications.Job.paymentFailed",
      }),
    );
  });

  it("reports job-failure webhook HTTP errors to Sentry with response context", async () => {
    requestFetchMock.mockResolvedValue(
      new Response("kaboom", { status: 500, statusText: "Server Error" }),
    );

    const updatedFailedJob = createJob({
      status: SokosumiJobStatus.PAYMENT_FAILED,
      agent: {
        id: "agent_1",
        name: "Planner",
        metadataOverride: { name: "Display Name" },
        blockchainIdentifier: "agent-chain-1",
        authorContactEmail: "author@example.com",
      },
      events: [
        createJobEvent({
          id: "event_2",
          status: AgentJobStatus.FAILED,
          result: "boom",
          statusHash: "new-hash",
        }),
      ],
    });

    mockInitialJobQueries({
      agent: [createJob()],
    });
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "failed",
        result: "boom",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValueOnce(updatedFailedJob);

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    await vi.waitFor(() => {
      expect(captureMessageMock).toHaveBeenCalledWith(
        "Failed to call job-failure webhook",
        expect.objectContaining({
          level: "warning",
          extra: expect.objectContaining({
            jobId: "job_1",
            userId: "user_1",
            notificationType: "job-failure-webhook",
            responseStatus: 500,
            responseBody: "kaboom",
          }),
        }),
      );
    });
  });

  it("publishes on-chain-only payment failures even when the agent status hash is unchanged", async () => {
    const paymentFailedJob = createJob({
      status: SokosumiJobStatus.PAYMENT_FAILED,
      purchase: {
        externalId: "purchase_1",
        onChainStatus: "FUNDS_OR_DATUM_INVALID",
        resultHash: null,
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      },
      events: [
        createJobEvent({
          id: "event_1",
          status: AgentJobStatus.RUNNING,
          result: null,
          statusHash: "old-hash",
        }),
      ],
    });

    mockInitialJobQueries({});
    mockPurchaseDiff(createJob(), {
      id: "purchase_1",
      onChainStatus: "FUNDS_OR_DATUM_INVALID",
      nextAction: "NONE",
      nextActionErrorType: null,
      nextActionErrorNote: null,
    });
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "running",
        result: null,
        input_schema: null,
        statusHash: "old-hash",
      }),
    );
    getJobByIdMock.mockResolvedValue(paymentFailedJob);

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(updateJobPurchaseByJobIdMock).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({
        onChainStatus: "FUNDS_OR_DATUM_INVALID",
      }),
      {},
    );
    expect(refundJobMock).not.toHaveBeenCalled();
    expect(renderJobFailureNotificationEmailMock).toHaveBeenCalledWith({
      network: "Preprod",
      agentId: "agent_1",
      agentBlockchainIdentifier: "agent-chain-1",
      agentName: "Planner",
      jobId: "job_1",
      jobBlockchainIdentifier: "blockchain-job-1",
      onChainStatus: "FUNDS_OR_DATUM_INVALID",
      agentStatus: SokosumiJobStatus.PAYMENT_FAILED,
      result: "N/A",
      resultHash: "N/A",
      locale: "en",
    });
    expect(publishJobStatusDataMock).toHaveBeenCalledWith({
      agentId: "agent_1",
      userId: "user_1",
      jobId: "job_1",
      jobStatus: SokosumiJobStatus.PAYMENT_FAILED,
      jobStatusSettled: false,
    });
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "event_1",
        messageKey: "Notifications.Job.paymentFailed",
      }),
    );
  });

  it("creates a distinct in-app notification when purchase status changes without an agent event update", async () => {
    const sharedEvent = createJobEvent({
      id: "event_2",
      status: AgentJobStatus.COMPLETED,
      result: "done",
      statusHash: "new-hash",
    });
    const completedJob = createJob({
      status: SokosumiJobStatus.COMPLETED,
      events: [sharedEvent],
    });
    const paymentFailedJob = createJob({
      status: SokosumiJobStatus.PAYMENT_FAILED,
      purchase: {
        externalId: "purchase_1",
        onChainStatus: "FUNDS_OR_DATUM_INVALID",
        resultHash: null,
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      },
      events: [sharedEvent],
    });

    mockInitialJobQueries({});
    mockPurchaseDiff(completedJob, {
      id: "purchase_1",
      onChainStatus: "FUNDS_OR_DATUM_INVALID",
      nextAction: "NONE",
      nextActionErrorType: null,
      nextActionErrorNote: null,
    });
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "completed",
        result: "done",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValue(paymentFailedJob);
    createJobEventForJobIdMock.mockResolvedValueOnce({ id: "event_3" });

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(createJobEventForJobIdMock).not.toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "event_2",
        messageKey: "Notifications.Job.paymentFailed",
      }),
    );
  });

  it("ignores late completed agent results when a purchase-state payment failure resolves in the same sync cycle", async () => {
    const paymentFailedJob = createJob({
      status: SokosumiJobStatus.PAYMENT_FAILED,
      purchase: {
        externalId: "purchase_1",
        onChainStatus: "FUNDS_OR_DATUM_INVALID",
        resultHash: null,
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      },
    });

    mockInitialJobQueries({});
    mockPurchaseDiff(createJob(), {
      id: "purchase_1",
      onChainStatus: "FUNDS_OR_DATUM_INVALID",
      nextAction: "NONE",
      nextActionErrorType: null,
      nextActionErrorNote: null,
    });
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "completed",
        result: "done",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValue(paymentFailedJob);

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(updateJobPurchaseByJobIdMock).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({
        onChainStatus: "FUNDS_OR_DATUM_INVALID",
      }),
      {},
    );
    expect(getLatestJobEventByJobIdMock).not.toHaveBeenCalled();
    expect(createJobEventForJobIdMock).not.toHaveBeenCalled();
    expect(sourceImportEnqueueMock).not.toHaveBeenCalled();
    expect(refundJobMock).not.toHaveBeenCalled();
    expect(renderJobFailureNotificationEmailMock).toHaveBeenCalledWith({
      network: "Preprod",
      agentId: "agent_1",
      agentBlockchainIdentifier: "agent-chain-1",
      agentName: "Planner",
      jobId: "job_1",
      jobBlockchainIdentifier: "blockchain-job-1",
      onChainStatus: "FUNDS_OR_DATUM_INVALID",
      agentStatus: SokosumiJobStatus.PAYMENT_FAILED,
      result: "N/A",
      resultHash: "N/A",
      locale: "en",
    });
  });

  it("ignores late completed agent results when a missing purchase times out in the same sync cycle", async () => {
    const paymentFailedJob = createJob({
      status: SokosumiJobStatus.PAYMENT_FAILED,
      purchase: null,
      payByTime: new Date("2026-03-18T09:45:00.000Z"),
    });

    mockInitialJobQueries({
      unfinished: [
        createJob({
          purchase: null,
          status: SokosumiJobStatus.PAYMENT_PENDING,
          payByTime: new Date("2026-03-18T09:45:00.000Z"),
        }),
      ],
    });
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(err("not found"));
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "completed",
        result: "done",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValueOnce(paymentFailedJob);

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(createJobPurchaseMock).not.toHaveBeenCalled();
    expect(getLatestJobEventByJobIdMock).toHaveBeenCalledWith("job_1", {});
    expect(createJobEventForJobIdMock).toHaveBeenCalledWith(
      "job_1",
      {
        status: AgentJobStatus.COMPLETED,
        inputSchema: undefined,
        result: "done",
        statusHash: "new-hash",
      },
      {},
    );
    expect(sourceImportEnqueueMock).toHaveBeenCalledWith("event_2", "done");
    expect(refundJobMock).not.toHaveBeenCalled();
    expect(renderJobFailureNotificationEmailMock).toHaveBeenCalledWith({
      network: "Preprod",
      agentId: "agent_1",
      agentBlockchainIdentifier: "agent-chain-1",
      agentName: "Planner",
      jobId: "job_1",
      jobBlockchainIdentifier: "blockchain-job-1",
      onChainStatus: "N/A",
      agentStatus: SokosumiJobStatus.PAYMENT_FAILED,
      result: "N/A",
      resultHash: "N/A",
      locale: "en",
    });
    expect(publishJobStatusDataMock).toHaveBeenCalledWith({
      agentId: "agent_1",
      userId: "user_1",
      jobId: "job_1",
      jobStatus: SokosumiJobStatus.PAYMENT_FAILED,
      jobStatusSettled: false,
    });
  });

  it("ignores late completed agent results when a null-on-chain purchase times out in the same sync cycle", async () => {
    const paymentFailedJob = createJob({
      status: SokosumiJobStatus.PAYMENT_FAILED,
      payByTime: new Date("2026-03-18T09:45:00.000Z"),
      purchase: {
        externalId: "purchase_1",
        onChainStatus: null,
        resultHash: null,
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      },
    });

    mockInitialJobQueries({});
    mockPurchaseDiff(
      createJob({
        status: SokosumiJobStatus.PAYMENT_PENDING,
        payByTime: new Date("2026-03-18T09:45:00.000Z"),
        purchase: {
          externalId: "purchase_1",
          onChainStatus: null,
          resultHash: null,
          nextAction: "FUNDS_LOCKING_REQUESTED",
          nextActionErrorType: null,
          nextActionErrorNote: null,
        },
      }),
      {
        id: "purchase_1",
        onChainStatus: null,
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      },
    );
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "completed",
        result: "done",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValue(paymentFailedJob);

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(updateJobPurchaseByJobIdMock).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({
        onChainStatus: null,
        nextAction: "NONE",
        nextActionErrorType: null,
      }),
      {},
    );
    expect(getLatestJobEventByJobIdMock).not.toHaveBeenCalled();
    expect(createJobEventForJobIdMock).not.toHaveBeenCalled();
    expect(sourceImportEnqueueMock).not.toHaveBeenCalled();
    expect(refundJobMock).not.toHaveBeenCalled();
    expect(renderJobFailureNotificationEmailMock).toHaveBeenCalledWith({
      network: "Preprod",
      agentId: "agent_1",
      agentBlockchainIdentifier: "agent-chain-1",
      agentName: "Planner",
      jobId: "job_1",
      jobBlockchainIdentifier: "blockchain-job-1",
      onChainStatus: "N/A",
      agentStatus: SokosumiJobStatus.PAYMENT_FAILED,
      result: "N/A",
      resultHash: "N/A",
      locale: "en",
    });
    expect(publishJobStatusDataMock).toHaveBeenCalledWith({
      agentId: "agent_1",
      userId: "user_1",
      jobId: "job_1",
      jobStatus: SokosumiJobStatus.PAYMENT_FAILED,
      jobStatusSettled: false,
    });
  });

  it("persists agent status when null-on-chain purchase is past pay window but has an active next action", async () => {
    const pendingWithActiveAction = createJob({
      status: SokosumiJobStatus.PAYMENT_PENDING,
      payByTime: new Date("2020-01-01T00:00:00.000Z"),
      purchase: {
        externalId: "purchase_1",
        onChainStatus: null,
        resultHash: null,
        nextAction: "FUNDS_LOCKING_REQUESTED",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      },
    });

    mockInitialJobQueries({
      agent: [pendingWithActiveAction],
    });
    mockPurchaseDiff(pendingWithActiveAction, {
      id: "purchase_1",
      onChainStatus: null,
      nextAction: "FUNDS_LOCKING_REQUESTED",
      nextActionErrorType: null,
      nextActionErrorNote: null,
    });
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "completed",
        result: "done",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock
      .mockResolvedValueOnce(pendingWithActiveAction)
      .mockResolvedValueOnce(pendingWithActiveAction)
      .mockResolvedValueOnce(pendingWithActiveAction);

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(updateJobPurchaseByJobIdMock).toHaveBeenCalled();
    expect(getLatestJobEventByJobIdMock).toHaveBeenCalled();
    expect(createJobEventForJobIdMock).toHaveBeenCalled();
  });

  it("keeps payment pending when a purchase action errors in the same sync cycle", async () => {
    const paymentPendingJob = createJob({
      status: SokosumiJobStatus.PAYMENT_PENDING,
      purchase: {
        externalId: "purchase_1",
        onChainStatus: null,
        resultHash: null,
        nextAction: "FUNDS_LOCKING_REQUESTED",
        nextActionErrorType: "NETWORK_ERROR",
        nextActionErrorNote: null,
      },
    });

    mockInitialJobQueries({});
    mockPurchaseDiff(
      createJob({
        status: SokosumiJobStatus.PAYMENT_PENDING,
        purchase: {
          externalId: "purchase_1",
          onChainStatus: null,
          resultHash: null,
          nextAction: "FUNDS_LOCKING_REQUESTED",
          nextActionErrorType: null,
          nextActionErrorNote: null,
        },
      }),
      {
        id: "purchase_1",
        onChainStatus: null,
        nextAction: "FUNDS_LOCKING_REQUESTED",
        nextActionErrorType: "NETWORK_ERROR",
        nextActionErrorNote: null,
      },
    );
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "completed",
        result: "done",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValueOnce(paymentPendingJob);

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(updateJobPurchaseByJobIdMock).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({
        onChainStatus: null,
        nextAction: "FUNDS_LOCKING_REQUESTED",
        nextActionErrorType: "NETWORK_ERROR",
      }),
      {},
    );
    expect(getLatestJobEventByJobIdMock).not.toHaveBeenCalled();
    expect(createJobEventForJobIdMock).not.toHaveBeenCalled();
    expect(sourceImportEnqueueMock).not.toHaveBeenCalled();
    expect(refundJobMock).not.toHaveBeenCalled();
    expect(renderJobFailureNotificationEmailMock).not.toHaveBeenCalled();
    expect(publishJobStatusDataMock).not.toHaveBeenCalled();
  });

  it("ignores late completed agent results when a refund resolves in the same sync cycle", async () => {
    const refundResolvedJob = createJob({
      status: SokosumiJobStatus.REFUND_RESOLVED,
      purchase: {
        externalId: "purchase_1",
        onChainStatus: "REFUND_WITHDRAWN",
        resultHash: null,
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      },
    });

    mockInitialJobQueries({});
    mockPurchaseDiff(
      createJob({
        status: SokosumiJobStatus.REFUND_PENDING,
        purchase: {
          externalId: "purchase_1",
          onChainStatus: "REFUND_REQUESTED",
          resultHash: null,
          nextAction: "NONE",
          nextActionErrorType: null,
          nextActionErrorNote: null,
        },
      }),
      {
        id: "purchase_1",
        onChainStatus: "REFUND_WITHDRAWN",
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      },
    );
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "completed",
        result: "done",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValue(refundResolvedJob);

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(updateJobPurchaseByJobIdMock).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({
        onChainStatus: "REFUND_WITHDRAWN",
      }),
      {},
    );
    expect(getLatestJobEventByJobIdMock).not.toHaveBeenCalled();
    expect(createJobEventForJobIdMock).not.toHaveBeenCalled();
    expect(sourceImportEnqueueMock).not.toHaveBeenCalled();
    expect(refundJobMock).not.toHaveBeenCalled();
    expect(publishJobStatusDataMock).toHaveBeenCalledWith({
      agentId: "agent_1",
      userId: "user_1",
      jobId: "job_1",
      jobStatus: SokosumiJobStatus.REFUND_RESOLVED,
      jobStatusSettled: false,
    });
  });

  it("ignores late completed agent results when a dispute resolves in the same sync cycle", async () => {
    const disputeResolvedJob = createJob({
      status: SokosumiJobStatus.DISPUTE_RESOLVED,
      purchase: {
        externalId: "purchase_1",
        onChainStatus: "DISPUTED_WITHDRAWN",
        resultHash: null,
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      },
    });

    mockInitialJobQueries({});
    mockPurchaseDiff(
      createJob({
        status: SokosumiJobStatus.DISPUTE_PENDING,
        purchase: {
          externalId: "purchase_1",
          onChainStatus: "DISPUTED",
          resultHash: null,
          nextAction: "NONE",
          nextActionErrorType: null,
          nextActionErrorNote: null,
        },
      }),
      {
        id: "purchase_1",
        onChainStatus: "DISPUTED_WITHDRAWN",
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      },
    );
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "completed",
        result: "done",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValue(disputeResolvedJob);

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(updateJobPurchaseByJobIdMock).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({
        onChainStatus: "DISPUTED_WITHDRAWN",
      }),
      {},
    );
    expect(getLatestJobEventByJobIdMock).not.toHaveBeenCalled();
    expect(createJobEventForJobIdMock).not.toHaveBeenCalled();
    expect(sourceImportEnqueueMock).not.toHaveBeenCalled();
    expect(refundJobMock).not.toHaveBeenCalled();
    expect(publishJobStatusDataMock).toHaveBeenCalledWith({
      agentId: "agent_1",
      userId: "user_1",
      jobId: "job_1",
      jobStatus: SokosumiJobStatus.DISPUTE_RESOLVED,
      jobStatusSettled: false,
    });
  });

  it("sends input-required notifications when a job starts awaiting input", async () => {
    const awaitingInputJob = createJob({
      status: SokosumiJobStatus.INPUT_REQUIRED,
      agent: {
        id: "agent_1",
        name: "Planner",
        metadataOverride: { name: "Display Name" },
        blockchainIdentifier: "agent-chain-1",
        authorContactEmail: null,
      },
      events: [
        createJobEvent({
          id: "event_2",
          status: AgentJobStatus.AWAITING_INPUT,
          result: null,
          statusHash: "new-hash",
          input: null,
        }),
      ],
    });

    mockInitialJobQueries({
      agent: [createJob()],
    });
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "awaiting_input",
        result: null,
        input_schema: [{ id: "prompt", type: "string", name: "Prompt" }],
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValueOnce(awaitingInputJob);

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(renderJobInputRequiredEmailMock).toHaveBeenCalledWith({
      recipientName: "Ada",
      agentName: "Display Name",
      jobLink: "https://app.sokosumi.test/agents/agent_1/jobs/job_1",
      jobName: undefined,
      locale: "en",
    });
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        tag: "job-input-required",
      }),
    );
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith({
      userId: "user_1",
      kind: NotificationKind.JOB,
      referenceId: "job_1",
      eventId: "event_2",
      messageKey: "Notifications.Job.inputRequired",
      messageParams: {
        agentName: "Display Name",
        jobName: "Untitled job",
      },
      metadata: {
        agentId: "agent_1",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
    });
  });

  it("does not fail the sync when webhook, email, or ably publishing fails", async () => {
    const completedJob = createJob({
      status: SokosumiJobStatus.COMPLETED,
      jobStatusSettled: true,
      completedAt: new Date("2026-03-18T10:05:00.000Z"),
      events: [
        createJobEvent({
          id: "event_2",
          status: AgentJobStatus.COMPLETED,
          result: "done",
          statusHash: "new-hash",
        }),
      ],
    });

    mockInitialJobQueries({
      unfinished: [createJob()],
    });
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "completed",
        result: "done",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValueOnce(completedJob);
    sendEmailMock.mockRejectedValue(new Error("email down"));
    publishJobStatusDataMock.mockRejectedValue(new Error("ably down"));
    requestFetchMock.mockRejectedValue(new Error("webhook down"));

    await expect(
      jobSyncService.syncUnfinishedJobs(createExecutionOptions()),
    ).resolves.toEqual(
      expect.objectContaining({
        processed: 1,
        unfinishedFound: 1,
      }),
    );
  });

  it("awaits Resend batch flush so sync waitUntil covers delivery", async () => {
    const emailGate = Promise.withResolvers<void>();
    const emailStarted = Promise.withResolvers<void>();

    const completedJob = createJob({
      status: SokosumiJobStatus.COMPLETED,
      jobStatusSettled: true,
      events: [
        createJobEvent({
          id: "event_2",
          status: AgentJobStatus.COMPLETED,
          result: "done",
          statusHash: "new-hash",
        }),
      ],
    });

    mockInitialJobQueries({ unfinished: [createJob()] });
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "completed",
        result: "done",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValueOnce(completedJob);
    sendEmailsMock.mockImplementation(async (emails: unknown[]) => {
      emailStarted.resolve();
      await emailGate.promise;
      const results = [];
      for (const email of emails) {
        results.push(await sendEmailMock(email));
      }
      return results;
    });

    const syncPromise = jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );
    let syncSettled = false;
    void syncPromise.then(() => {
      syncSettled = true;
    });

    await emailStarted.promise;
    await Promise.resolve();
    expect(syncSettled).toBe(false);

    emailGate.resolve();
    await expect(syncPromise).resolves.toEqual(
      expect.objectContaining({ processed: 1 }),
    );
    expect(syncSettled).toBe(true);
    expect(sendEmailsMock).toHaveBeenCalled();
  });

  it("awaits source import enqueue so sync waitUntil covers link upserts", async () => {
    const enqueueGate = Promise.withResolvers<void>();
    const enqueueStarted = Promise.withResolvers<void>();

    const completedJob = createJob({
      status: SokosumiJobStatus.COMPLETED,
      jobStatusSettled: true,
      events: [
        createJobEvent({
          id: "event_2",
          status: AgentJobStatus.COMPLETED,
          result: "[report](https://example.com/out.pdf)",
          statusHash: "new-hash",
        }),
      ],
    });

    mockInitialJobQueries({ unfinished: [createJob()] });
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "completed",
        result: "[report](https://example.com/out.pdf)",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValueOnce(completedJob);
    sourceImportEnqueueMock.mockImplementation(async () => {
      enqueueStarted.resolve();
      await enqueueGate.promise;
    });

    const syncPromise = jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );
    let syncSettled = false;
    void syncPromise.then(() => {
      syncSettled = true;
    });

    await enqueueStarted.promise;
    // Fire-and-forget enqueue lets the rest of sync settle while upserts
    // are still in flight. Flush that work before asserting coverage.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(syncSettled).toBe(false);

    enqueueGate.resolve();
    await expect(syncPromise).resolves.toEqual(
      expect.objectContaining({ processed: 1 }),
    );
    expect(syncSettled).toBe(true);
    expect(sourceImportEnqueueMock).toHaveBeenCalledWith(
      "event_2",
      "[report](https://example.com/out.pdf)",
    );
  });

  it("flushes pending status emails in one sendEmails batch call", async () => {
    const completedById = new Map([
      [
        "job_1",
        createJob({
          id: "job_1",
          status: SokosumiJobStatus.COMPLETED,
          jobStatusSettled: true,
          events: [
            createJobEvent({
              id: "event_2",
              status: AgentJobStatus.COMPLETED,
              result: "done-1",
              statusHash: "new-hash",
            }),
          ],
        }),
      ],
      [
        "job_2",
        createJob({
          id: "job_2",
          owner: {
            id: "user_2",
            name: "Bob",
            email: "bob@example.com",
            notificationsOptIn: true,
          },
          ownerId: "user_2",
          status: SokosumiJobStatus.COMPLETED,
          jobStatusSettled: true,
          events: [
            createJobEvent({
              id: "event_3",
              status: AgentJobStatus.COMPLETED,
              result: "done-2",
              statusHash: "new-hash",
            }),
          ],
        }),
      ],
    ]);

    mockInitialJobQueries({
      unfinished: [
        createJob({ id: "job_1" }),
        createJob({
          id: "job_2",
          owner: {
            id: "user_2",
            name: "Bob",
            email: "bob@example.com",
            notificationsOptIn: true,
          },
          ownerId: "user_2",
        }),
      ],
    });
    fetchAgentJobStatusMock.mockImplementation(async () =>
      ok({
        status: "completed",
        result: "done",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockImplementation(async (jobId: string) => {
      return completedById.get(jobId) ?? createJob({ id: jobId });
    });
    createJobEventForJobIdMock.mockImplementation(async (jobId: string) => ({
      id: jobId === "job_1" ? "event_2" : "event_3",
    }));

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(sendEmailsMock).toHaveBeenCalledTimes(1);
    expect(sendEmailsMock.mock.calls[0]?.[0]).toHaveLength(2);
    expect(sendEmailsMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          to: "user@example.com",
          tag: "job-final-status",
        }),
        expect.objectContaining({
          to: "bob@example.com",
          tag: "job-final-status",
        }),
      ]),
    );
  });

  it("flushes queued emails when a later sync phase throws", async () => {
    const completedJob = createJob({
      status: SokosumiJobStatus.COMPLETED,
      jobStatusSettled: true,
      events: [
        createJobEvent({
          id: "event_2",
          status: AgentJobStatus.COMPLETED,
          result: "done",
          statusHash: "new-hash",
        }),
      ],
    });

    prismaJobFindManyMock.mockReset();
    prismaJobFindManyMock.mockResolvedValueOnce([]);
    prismaJobFindManyMock.mockResolvedValueOnce([]);
    prismaJobFindManyMock.mockResolvedValueOnce([createJob()]);
    prismaJobFindManyMock.mockRejectedValueOnce(new Error("refund query down"));

    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "completed",
        result: "done",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValueOnce(completedJob);

    await expect(
      jobSyncService.syncUnfinishedJobs(createExecutionOptions()),
    ).rejects.toThrow("refund query down");

    expect(sendEmailsMock).toHaveBeenCalledTimes(1);
    expect(sendEmailsMock).toHaveBeenCalledWith([
      expect.objectContaining({
        to: "user@example.com",
        tag: "job-final-status",
      }),
    ]);
  });

  it("counts unique jobs across purchase, agent, and refund phases in the same run", async () => {
    const reconciliationJob = createJob({
      id: "job_refund",
      status: SokosumiJobStatus.REFUND_RESOLVED,
      purchase: {
        externalId: "purchase_refund",
        onChainStatus: "REFUND_WITHDRAWN",
        resultHash: null,
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      },
    });
    mockInitialJobQueries({
      purchase: [createJob()],
      agent: [createJob()],
      pendingLocalRefunds: [reconciliationJob],
    });
    getJobByIdMock.mockImplementation(async (jobId: string) => {
      return jobId === "job_refund" ? reconciliationJob : createJob();
    });
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "running",
        result: null,
        input_schema: null,
        statusHash: "old-hash",
      }),
    );

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        processed: 3,
        unfinishedFound: 2,
      }),
    );
    expect(refundJobMock).toHaveBeenCalledWith("job_refund", {});
  });

  it("does not count thrown job sync failures as processed", async () => {
    const syncError = new Error("event write failed");

    mockInitialJobQueries({
      unfinished: [
        createJob(),
        createJob({
          id: "job_2",
          agentJobId: "remote-job-2",
          blockchainIdentifier: "blockchain-job-2",
          purchase: {
            externalId: "purchase_2",
            onChainStatus: null,
            resultHash: null,
            nextAction: "NONE",
            nextActionErrorType: null,
            nextActionErrorNote: null,
          },
        }),
      ],
    });
    fetchAgentJobStatusMock.mockImplementation((_agent, jobId: string) => {
      if (jobId === "remote-job-1") {
        return ok({
          status: "completed",
          result: "done",
          input_schema: null,
          statusHash: "new-hash",
        });
      }

      return ok({
        status: "running",
        result: null,
        input_schema: null,
        statusHash: "old-hash",
      });
    });
    createJobEventForJobIdMock.mockImplementation(async (jobId: string) => {
      if (jobId === "job_1") {
        throw syncError;
      }

      return { id: `event_${jobId}` };
    });

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        processed: 1,
        unfinishedFound: 2,
      }),
    );
    expect(withScopeMock).toHaveBeenCalled();
    expect(setExtrasMock).toHaveBeenCalledWith({ jobId: "job_1" });
    expect(captureExceptionMock).toHaveBeenCalledWith(syncError, undefined);
  });

  it("stops processing when already canceled before work starts", async () => {
    const controller = new AbortController();
    controller.abort();
    mockInitialJobQueries({
      unfinished: [createJob(), createJob({ id: "job_2" })],
    });

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions({
        abortSignal: controller.signal,
      }),
    );

    expect(result.unfinishedFound).toBe(2);
    expect(result.processed).toBe(0);
    expect(fetchAgentJobStatusMock).not.toHaveBeenCalled();
    expect(getPurchaseByBlockchainIdentifierMock).not.toHaveBeenCalled();
  });

  it("cancels an in-flight purchase backfill before transaction work begins", async () => {
    const controller = new AbortController();
    let resolvePollingStarted: (() => void) | null = null;
    const pollingStarted = new Promise<void>((resolve) => {
      resolvePollingStarted = resolve;
    });

    mockInitialJobQueries({
      purchase: [
        createJob({
          purchase: null,
          status: SokosumiJobStatus.PAYMENT_PENDING,
        }),
      ],
    });
    getPurchaseByBlockchainIdentifierMock.mockImplementation(
      (
        _blockchainIdentifier,
        options?: {
          signal?: AbortSignal;
        },
      ) => {
        resolvePollingStarted?.();

        return new Promise((resolve) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              resolve(err("aborted"));
            },
            { once: true },
          );
        });
      },
    );

    const resultPromise = jobSyncService.syncUnfinishedJobs(
      createExecutionOptions({
        abortSignal: controller.signal,
      }),
    );

    await pollingStarted;
    controller.abort();

    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({
        processed: 0,
        unfinishedFound: 1,
      }),
    );
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    expect(fetchAgentJobStatusMock).not.toHaveBeenCalled();
    expect(getPurchaseByBlockchainIdentifierMock).toHaveBeenCalledWith(
      "blockchain-job-1",
      expect.objectContaining({
        signal: expect.any(Object),
      }),
    );
  });

  it("still counts the job as processed when email delivery fails transiently", async () => {
    const initialJob = createJob({ status: SokosumiJobStatus.PROCESSING });
    const completedJob = createJob({
      status: SokosumiJobStatus.COMPLETED,
      jobStatusSettled: true,
      events: [
        createJobEvent({
          id: "event_2",
          status: AgentJobStatus.COMPLETED,
          statusHash: "new-hash",
        }),
      ],
    });

    mockInitialJobQueries({ agent: [initialJob] });
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "completed",
        result: null,
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValueOnce(completedJob);
    sendEmailMock.mockRejectedValue(
      Object.assign(
        new Error("Unable to fetch data. The request could not be resolved."),
        {
          name: "application_error",
          statusCode: null,
        },
      ),
    );

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(
      expect.objectContaining({ processed: 1, unfinishedFound: 1 }),
    );

    await vi.waitFor(() => {
      expect(sendEmailsMock).toHaveBeenCalled();
    });
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("skips purchase backfill gracefully on P2014 relation violation (concurrent job deletion)", async () => {
    const job = createJob({
      purchase: null,
      status: SokosumiJobStatus.PAYMENT_PENDING,
    });
    mockInitialJobQueries({ purchase: [job] });
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok(matchingResolvedPurchase(job, { id: "purchase_concurrent" })),
    );
    createJobPurchaseMock.mockRejectedValue(
      Object.assign(new Error("violates required relation"), { code: "P2014" }),
    );
    // Job was deleted concurrently, so the post-backfill refresh finds nothing.
    getJobByIdMock.mockResolvedValueOnce(null);

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(expect.objectContaining({ processed: 0 }));
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("skips purchase backfill gracefully on P2025 record-not-found (concurrent job deletion)", async () => {
    const job = createJob({
      purchase: null,
      status: SokosumiJobStatus.PAYMENT_PENDING,
    });
    mockInitialJobQueries({ purchase: [job] });
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok(matchingResolvedPurchase(job, { id: "purchase_missing" })),
    );
    createJobPurchaseMock.mockRejectedValue(
      Object.assign(new Error("record to update not found"), { code: "P2025" }),
    );
    // Job was deleted concurrently, so the post-backfill refresh finds nothing.
    getJobByIdMock.mockResolvedValueOnce(null);

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(expect.objectContaining({ processed: 0 }));
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("skips purchase backfill gracefully on P2002 unique constraint (concurrent purchase creation)", async () => {
    const job = createJob({
      purchase: null,
      status: SokosumiJobStatus.PAYMENT_PENDING,
    });
    mockInitialJobQueries({ purchase: [job] });
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok(matchingResolvedPurchase(job, { id: "purchase_duplicate" })),
    );
    createJobPurchaseMock.mockRejectedValue(
      Object.assign(new Error("unique constraint failed"), { code: "P2002" }),
    );

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(expect.objectContaining({ processed: 1 }));
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("propagates unexpected Prisma errors in the backfill path to Sentry", async () => {
    const job = createJob({
      purchase: null,
      status: SokosumiJobStatus.PAYMENT_PENDING,
    });
    mockInitialJobQueries({ purchase: [job] });
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok(matchingResolvedPurchase(job, { id: "purchase_bad" })),
    );
    const unexpectedError = Object.assign(new Error("unexpected db error"), {
      code: "P2003",
    });
    createJobPurchaseMock.mockRejectedValue(unexpectedError);

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(expect.objectContaining({ processed: 0 }));
    expect(withScopeMock).toHaveBeenCalled();
    expect(setExtrasMock).toHaveBeenCalledWith({ jobId: "job_1" });
    expect(captureExceptionMock).toHaveBeenCalledWith(
      unexpectedError,
      undefined,
    );
  });
});
