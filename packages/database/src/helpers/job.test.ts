import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { JobType } from "../generated/prisma/client.js";
import { SokosumiJobStatus } from "../types/job.js";
import { computeJobStatus } from "./job.js";

function createPaidJob(overrides: Record<string, unknown> = {}) {
  const now = new Date();

  return {
    id: "job-1",
    createdAt: new Date(now.getTime() - 60 * 60 * 1000),
    updatedAt: now,
    userId: "user-1",
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
    jobScheduleId: null,
    taskId: null,
    workspaceId: null,
    purchase: null,
    events: [],
    transaction: null,
    workspace: null,
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
});
