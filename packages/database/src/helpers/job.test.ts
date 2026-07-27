import assert from "node:assert/strict";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { describe, it } from "vitest";
import { JobType } from "../generated/prisma/client.js";
import { computeJobStatus, isJobStatusSettled } from "./job.js";

function createPaidJob(overrides: Record<string, unknown> = {}) {
  const now = new Date();

  return {
    id: "job-1",
    createdAt: new Date(now.getTime() - 60 * 60 * 1000),
    updatedAt: now,
    ownerId: "user-1",
    organizationId: null,
    agentId: "agent-1",
    agentJobId: "remote-job-1",
    jobType: JobType.PAID,
    blockchainIdentifier: "blockchain-job-1",
    identifierFromPurchaser: "identifier",
    payByTime: new Date(now.getTime() + 60 * 1000),
    submitResultTime: null,
    unlockTime: null,
    externalDisputeUnlockTime: null,
    sellerVkey: null,
    transactionId: "transaction-1",
    refundedTransactionId: null,
    name: null,
    taskId: null,
    projectId: null,
    workspaceId: "11111111-1111-7111-8111-111111111111",
    purchase: null,
    events: [],
    transaction: null,
    workspace: {
      id: "11111111-1111-7111-8111-111111111111",
      userId: "user-1",
      organizationId: null,
      user: null,
      organization: null,
    },
    ...overrides,
  };
}

function createPurchase(overrides: Record<string, unknown> = {}) {
  const now = new Date();

  return {
    externalId: "purchase-1",
    onChainStatus: null,
    onChainTransactionHash: null,
    onChainTransactionStatus: null,
    resultHash: null,
    nextAction: "NONE",
    nextActionErrorType: null,
    nextActionErrorNote: null,
    createdAt: now,
    updatedAt: now,
    jobId: "job-1",
    errorNote: null,
    errorNoteKey: null,
    ...overrides,
  };
}

function createJobEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    status: "RUNNING",
    result: null,
    statusHash: "old-hash",
    input: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("computeJobStatus", () => {
  it("keeps missing-purchase jobs payment-pending until payByTime plus grace expires", () => {
    const now = new Date();
    const job = createPaidJob({
      createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      payByTime: new Date(now.getTime() - 5 * 60 * 1000),
    });

    assert.equal(computeJobStatus(job), SokosumiJobStatus.PAYMENT_PENDING);
  });

  it("marks missing-purchase jobs payment-failed once payByTime plus grace expires", () => {
    const now = new Date();
    const job = createPaidJob({
      payByTime: new Date(now.getTime() - 11 * 60 * 1000),
    });

    assert.equal(computeJobStatus(job), SokosumiJobStatus.PAYMENT_FAILED);
  });

  it("keeps null-on-chain purchases payment-pending when the purchase action errors", () => {
    const now = new Date();
    const job = createPaidJob({
      payByTime: new Date(now.getTime() + 30 * 60 * 1000),
      purchase: {
        externalId: "purchase-1",
        onChainStatus: null,
        onChainTransactionHash: null,
        onChainTransactionStatus: null,
        resultHash: null,
        nextAction: "FUNDS_LOCKING_REQUESTED",
        nextActionErrorType: "NETWORK_ERROR",
        nextActionErrorNote: null,
        createdAt: now,
        updatedAt: now,
        jobId: "job-1",
        errorNote: null,
        errorNoteKey: null,
      },
      events: [
        {
          id: "event-1",
          status: "RUNNING",
          result: null,
          statusHash: "old-hash",
          input: null,
          createdAt: now,
        },
      ],
    });

    assert.equal(computeJobStatus(job), SokosumiJobStatus.PAYMENT_PENDING);
  });

  it("keeps null-on-chain purchases payment-pending after payByTime plus grace expires", () => {
    const now = new Date();
    const job = createPaidJob({
      payByTime: new Date(now.getTime() - 11 * 60 * 1000),
      purchase: {
        externalId: "purchase-1",
        onChainStatus: null,
        onChainTransactionHash: null,
        onChainTransactionStatus: null,
        resultHash: null,
        nextAction: "NONE",
        nextActionErrorType: "NETWORK_ERROR",
        nextActionErrorNote: null,
        createdAt: now,
        updatedAt: now,
        jobId: "job-1",
        errorNote: null,
        errorNoteKey: null,
      },
      events: [
        {
          id: "event-1",
          status: "RUNNING",
          result: null,
          statusHash: "old-hash",
          input: null,
          createdAt: now,
        },
      ],
    });

    assert.equal(computeJobStatus(job), SokosumiJobStatus.PAYMENT_PENDING);
  });

  it("marks invalid on-chain purchases payment-failed", () => {
    const now = new Date();
    const job = createPaidJob({
      purchase: {
        externalId: "purchase-1",
        onChainStatus: "FUNDS_OR_DATUM_INVALID",
        onChainTransactionHash: null,
        onChainTransactionStatus: null,
        resultHash: null,
        nextAction: "NONE",
        nextActionErrorType: null,
        nextActionErrorNote: null,
        createdAt: now,
        updatedAt: now,
        jobId: "job-1",
        errorNote: null,
        errorNoteKey: null,
      },
      events: [
        {
          id: "event-1",
          status: "RUNNING",
          result: null,
          statusHash: "old-hash",
          input: null,
          createdAt: now,
        },
      ],
    });

    assert.equal(computeJobStatus(job), SokosumiJobStatus.PAYMENT_FAILED);
  });

  it("marks withdraw-authorized purchases completed when the agent completed", () => {
    const job = createPaidJob({
      purchase: createPurchase({ onChainStatus: "WITHDRAW_AUTHORIZED" }),
      events: [createJobEvent({ status: "COMPLETED", result: "result" })],
    });

    assert.equal(computeJobStatus(job), SokosumiJobStatus.COMPLETED);
  });

  it("keeps withdraw-authorized purchases result-pending when the agent has not completed", () => {
    const job = createPaidJob({
      purchase: createPurchase({ onChainStatus: "WITHDRAW_AUTHORIZED" }),
      events: [createJobEvent({ status: "RUNNING" })],
    });

    assert.equal(computeJobStatus(job), SokosumiJobStatus.RESULT_PENDING);
  });

  it("marks refund-authorized purchases refund-pending", () => {
    const job = createPaidJob({
      purchase: createPurchase({ onChainStatus: "REFUND_AUTHORIZED" }),
      events: [createJobEvent({ status: "RUNNING" })],
    });

    assert.equal(computeJobStatus(job), SokosumiJobStatus.REFUND_PENDING);
  });

  it("lets authorize-withdrawal next actions fall through to the on-chain status", () => {
    const requestedJob = createPaidJob({
      purchase: createPurchase({
        onChainStatus: "RESULT_SUBMITTED",
        nextAction: "AUTHORIZE_WITHDRAWAL_REQUESTED",
      }),
      events: [createJobEvent({ status: "COMPLETED", result: "result" })],
    });

    // The next-action branch must not short-circuit into
    // REFUND_PENDING/PAYMENT_PENDING; the on-chain branch resolves the status.
    assert.equal(computeJobStatus(requestedJob), SokosumiJobStatus.COMPLETED);

    const initiatedJob = createPaidJob({
      purchase: createPurchase({
        onChainStatus: "RESULT_SUBMITTED",
        nextAction: "AUTHORIZE_WITHDRAWAL_INITIATED",
      }),
      events: [createJobEvent({ status: "RUNNING" })],
    });

    assert.equal(
      computeJobStatus(initiatedJob),
      SokosumiJobStatus.RESULT_PENDING,
    );
  });
});

describe("isJobStatusSettled", () => {
  it("marks FREE jobs settled only when completedAt is set", () => {
    assert.equal(
      isJobStatusSettled(
        { jobType: JobType.FREE, externalDisputeUnlockTime: null },
        null,
      ),
      false,
    );
    assert.equal(
      isJobStatusSettled(
        { jobType: JobType.FREE, externalDisputeUnlockTime: null },
        new Date("2026-01-01T00:00:00.000Z"),
      ),
      true,
    );
  });

  it("marks PAID jobs settled only after external dispute unlock", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    assert.equal(
      isJobStatusSettled(
        { jobType: JobType.PAID, externalDisputeUnlockTime: null },
        new Date("2026-01-01T00:00:00.000Z"),
        now,
      ),
      false,
    );
    assert.equal(
      isJobStatusSettled(
        {
          jobType: JobType.PAID,
          externalDisputeUnlockTime: new Date("2026-06-01T13:00:00.000Z"),
        },
        new Date("2026-01-01T00:00:00.000Z"),
        now,
      ),
      false,
    );
    assert.equal(
      isJobStatusSettled(
        {
          jobType: JobType.PAID,
          externalDisputeUnlockTime: new Date("2026-06-01T11:00:00.000Z"),
        },
        new Date("2026-01-01T00:00:00.000Z"),
        now,
      ),
      true,
    );
  });
});
