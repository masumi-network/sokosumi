import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
    purchase: null,
    events: [],
    transaction: null,
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
});
