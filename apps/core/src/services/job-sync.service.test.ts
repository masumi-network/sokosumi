import { AgentJobStatus, AgentStatus, JobType } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { jobSyncService } from "./job-sync.service";

const {
  captureExceptionMock,
  captureMessageMock,
  createJobEventForJobIdMock,
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
  sourceImportEnqueueMock,
  paymentClientFactoryMock,
  getPurchaseByBlockchainIdentifierMock,
  getPurchaseByIdMock,
  updateJobPurchaseByJobIdMock,
  refundJobMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  captureMessageMock: vi.fn(),
  createJobEventForJobIdMock: vi.fn(),
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
  sourceImportEnqueueMock: vi.fn(),
  paymentClientFactoryMock: vi.fn(),
  getPurchaseByBlockchainIdentifierMock: vi.fn(),
  getPurchaseByIdMock: vi.fn(),
  updateJobPurchaseByJobIdMock: vi.fn(),
  refundJobMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@vercel/related-projects", () => ({
  withRelatedProject: (opts: { defaultHost: string }) => opts.defaultHost,
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
  captureMessage: captureMessageMock,
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

vi.mock("@sokosumi/masumi", () => ({
  createAgentClient: () => ({
    fetchAgentJobStatus: fetchAgentJobStatusMock,
  }),
}));

vi.mock("@/clients/masumi-payment.client", () => ({
  paymentClient: paymentClientFactoryMock,
}));

vi.mock("@/clients/postmark.client", () => ({
  postmarkClient: {
    sendEmail: sendEmailMock,
  },
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
    POSTMARK_FROM_EMAIL: "no-reply@example.com",
  }),
  getWebAppBaseUrl: () => "https://app.sokosumi.test",
}));

vi.mock("@/helpers/purchase", () => ({
  transformPurchaseToJobUpdate: (purchase: {
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
  }),
}));

vi.mock("@/lib/ably/publish", () => ({
  publishJobStatusData: publishJobStatusDataMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    job: {
      findMany: prismaJobFindManyMock,
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
    userId: "user_1",
    jobType: JobType.PAID,
    refundedTransactionId: null,
    blockchainIdentifier: "blockchain-job-1",
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
      authorContactEmail: null,
    },
    user: {
      id: "user_1",
      email: "user@example.com",
      name: "Ada",
      notificationsOptIn: true,
    },
    payByTime: new Date(now.getTime() + 30 * 60 * 1000),
    externalDisputeUnlockTime: new Date(now.getTime() + 60 * 60 * 1000),
    completedAt: null,
    status: SokosumiJobStatus.PROCESSING,
    jobStatusSettled: false,
    ...overrides,
  };
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
  agent,
  pendingLocalRefunds = [],
  unfinished,
}: {
  purchase?: Record<string, unknown>[];
  agent?: Record<string, unknown>[];
  pendingLocalRefunds?: Record<string, unknown>[];
  unfinished?: Record<string, unknown>[];
} = {}) {
  prismaJobFindManyMock.mockReset();
  prismaJobFindManyMock.mockResolvedValueOnce(purchase);
  prismaJobFindManyMock.mockResolvedValueOnce(agent ?? unfinished ?? []);
  prismaJobFindManyMock.mockResolvedValueOnce(pendingLocalRefunds);
}

describe("jobSyncService.syncUnfinishedJobs", () => {
  beforeEach(() => {
    for (const mock of [
      captureExceptionMock,
      captureMessageMock,
      createJobEventForJobIdMock,
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
      sourceImportEnqueueMock,
      paymentClientFactoryMock,
      getPurchaseByBlockchainIdentifierMock,
      getPurchaseByIdMock,
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
      getPurchaseById: getPurchaseByIdMock,
    });
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({});
    });
    mockInitialJobQueries();
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(err("not found"));
    getPurchaseByIdMock.mockReturnValue(err("not found"));
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
    publishJobStatusDataMock.mockResolvedValue(undefined);
    sourceImportEnqueueMock.mockResolvedValue(undefined);
    refundJobMock.mockResolvedValue(undefined);
    createJobPurchaseMock.mockResolvedValue(undefined);
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
    mockInitialJobQueries({
      purchase: [
        createJob({
          purchase: null,
          status: SokosumiJobStatus.PAYMENT_PENDING,
        }),
      ],
      agent: [backfilledJob],
    });
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok({
        id: "purchase_backfilled",
        resultHash: "result-hash",
      }),
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
    expect(getJobByIdMock).toHaveBeenCalledWith("job_1", expect.any(Object));
    expect(getPurchaseByIdMock).toHaveBeenCalledWith(
      "purchase_backfilled",
      expect.objectContaining({
        signal: expect.any(Object),
      }),
    );
    expect(fetchAgentJobStatusMock).toHaveBeenCalledWith(
      backfilledJob.agent,
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
    expect(getPurchaseByIdMock).not.toHaveBeenCalled();
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
      "[sync/jobs/purchase] Found 1 jobs for purchase sync",
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
    expect(getPurchaseByIdMock).not.toHaveBeenCalled();
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
    expect(getPurchaseByIdMock).not.toHaveBeenCalled();
    expect(createJobEventForJobIdMock).not.toHaveBeenCalled();
    expect(sourceImportEnqueueMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(publishJobStatusDataMock).not.toHaveBeenCalled();
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
    expect(getPurchaseByIdMock).not.toHaveBeenCalled();
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
    expect(getPurchaseByIdMock).not.toHaveBeenCalled();
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
    expect(getPurchaseByIdMock).not.toHaveBeenCalled();
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
    expect(getPurchaseByIdMock).not.toHaveBeenCalled();
    expect(createJobEventForJobIdMock).not.toHaveBeenCalled();
    expect(sourceImportEnqueueMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(publishJobStatusDataMock).not.toHaveBeenCalled();
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
      purchase: [offlineAgentJob],
      pendingLocalRefunds: [],
    });
    getPurchaseByIdMock.mockReturnValue(err("not found"));

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        processed: 1,
        unfinishedFound: 1,
      }),
    );
    expect(getPurchaseByIdMock).toHaveBeenCalledWith(
      "purchase_1",
      expect.objectContaining({
        signal: expect.any(Object),
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
        overrideName: "Display Name",
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
        To: "user@example.com",
        From: "no-reply@example.com",
        Tag: "job-final-status",
      }),
    );
    expect(publishJobStatusDataMock).toHaveBeenCalledWith({
      agentId: "agent_1",
      userId: "user_1",
      jobId: "job_1",
      jobStatus: SokosumiJobStatus.COMPLETED,
      jobStatusSettled: true,
    });
  });

  it("emits failure notifications for terminal payment failures", async () => {
    const updatedFailedJob = createJob({
      status: SokosumiJobStatus.PAYMENT_FAILED,
      agent: {
        id: "agent_1",
        name: "Planner",
        overrideName: "Display Name",
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
        To: "author@example.com",
        Bcc: "stakeholder1@example.com,stakeholder2@example.com",
        Tag: "job-failure-notification",
      }),
    );
    expect(requestFetchMock).toHaveBeenCalledTimes(1);
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
        overrideName: "Display Name",
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

    mockInitialJobQueries({
      purchase: [createJob()],
    });
    getPurchaseByIdMock.mockReturnValue(
      ok({
        id: "purchase_1",
        onChainStatus: "FUNDS_OR_DATUM_INVALID",
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      }),
    );
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "running",
        result: null,
        input_schema: null,
        statusHash: "old-hash",
      }),
    );
    getJobByIdMock.mockResolvedValueOnce(paymentFailedJob);

    await jobSyncService.syncUnfinishedJobs(createExecutionOptions());

    expect(updateJobPurchaseByJobIdMock).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({
        onChainStatus: "FUNDS_OR_DATUM_INVALID",
      }),
      {},
    );
    expect(createJobEventForJobIdMock).not.toHaveBeenCalled();
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

    mockInitialJobQueries({
      purchase: [createJob()],
    });
    getPurchaseByIdMock.mockReturnValue(
      ok({
        id: "purchase_1",
        onChainStatus: "FUNDS_OR_DATUM_INVALID",
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      }),
    );
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

    mockInitialJobQueries({
      purchase: [
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
      ],
    });
    getPurchaseByIdMock.mockReturnValue(
      ok({
        id: "purchase_1",
        onChainStatus: null,
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      }),
    );
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
      purchase: [pendingWithActiveAction],
      agent: [pendingWithActiveAction],
    });
    getPurchaseByIdMock.mockReturnValue(
      ok({
        id: "purchase_1",
        onChainStatus: null,
        nextAction: "FUNDS_LOCKING_REQUESTED",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      }),
    );
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

    mockInitialJobQueries({
      purchase: [
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
      ],
    });
    getPurchaseByIdMock.mockReturnValue(
      ok({
        id: "purchase_1",
        onChainStatus: null,
        nextAction: "FUNDS_LOCKING_REQUESTED",
        nextActionErrorType: "NETWORK_ERROR",
        nextActionErrorNote: null,
      }),
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

    mockInitialJobQueries({
      purchase: [
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
      ],
    });
    getPurchaseByIdMock.mockReturnValue(
      ok({
        id: "purchase_1",
        onChainStatus: "REFUND_WITHDRAWN",
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      }),
    );
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "completed",
        result: "done",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValueOnce(refundResolvedJob);

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

    mockInitialJobQueries({
      purchase: [
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
      ],
    });
    getPurchaseByIdMock.mockReturnValue(
      ok({
        id: "purchase_1",
        onChainStatus: "DISPUTED_WITHDRAWN",
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
      }),
    );
    fetchAgentJobStatusMock.mockReturnValue(
      ok({
        status: "completed",
        result: "done",
        input_schema: null,
        statusHash: "new-hash",
      }),
    );
    getJobByIdMock.mockResolvedValueOnce(disputeResolvedJob);

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
        overrideName: "Display Name",
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
        To: "user@example.com",
        Tag: "job-input-required",
      }),
    );
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
    expect(captureExceptionMock).toHaveBeenCalledWith(syncError, {
      extra: {
        jobId: "job_1",
      },
    });
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
    expect(getPurchaseByIdMock).not.toHaveBeenCalled();
  });

  it("cancels in-flight remote polling before transaction work begins", async () => {
    const controller = new AbortController();
    let resolvePollingStarted: (() => void) | null = null;
    const pollingStarted = new Promise<void>((resolve) => {
      resolvePollingStarted = resolve;
    });

    mockInitialJobQueries({
      purchase: [createJob()],
    });
    getPurchaseByIdMock.mockImplementation(
      (
        _purchaseId,
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
    expect(getPurchaseByIdMock).toHaveBeenCalledWith(
      "purchase_1",
      expect.objectContaining({
        signal: expect.any(Object),
      }),
    );
  });

  it("captures Postmark socket hang up errors in Sentry and still counts the job as processed", async () => {
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
    sendEmailMock.mockRejectedValue(new Error("socket hang up"));

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(
      expect.objectContaining({ processed: 1, unfinishedFound: 1 }),
    );

    await vi.waitFor(() => {
      expect(captureExceptionMock).toHaveBeenCalledWith(
        expect.objectContaining({ message: "socket hang up" }),
        expect.objectContaining({
          extra: expect.objectContaining({
            notificationType: "job-final-status",
          }),
        }),
      );
    });
  });

  it("skips purchase backfill gracefully on P2014 relation violation (concurrent job deletion)", async () => {
    const job = createJob({
      purchase: null,
      status: SokosumiJobStatus.PAYMENT_PENDING,
    });
    mockInitialJobQueries({ purchase: [job] });
    getPurchaseByBlockchainIdentifierMock.mockReturnValue(
      ok({ id: "purchase_concurrent" }),
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
      ok({ id: "purchase_missing" }),
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
      ok({ id: "purchase_duplicate" }),
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
      ok({ id: "purchase_bad" }),
    );
    const unexpectedError = Object.assign(new Error("unexpected db error"), {
      code: "P2003",
    });
    createJobPurchaseMock.mockRejectedValue(unexpectedError);

    const result = await jobSyncService.syncUnfinishedJobs(
      createExecutionOptions(),
    );

    expect(result).toEqual(expect.objectContaining({ processed: 0 }));
    expect(captureExceptionMock).toHaveBeenCalledWith(
      unexpectedError,
      expect.objectContaining({
        extra: expect.objectContaining({ jobId: "job_1" }),
      }),
    );
  });
});
