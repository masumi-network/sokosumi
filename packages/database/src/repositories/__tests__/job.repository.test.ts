import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CreditBucketReferenceType,
  type Prisma,
} from "../../generated/prisma/client.js";
import { REFUND_CREDITS_EXPIRY_DAYS } from "../../helpers/credit.js";
import { jobRepository } from "../job.repository.js";

describe("jobRepository.refundJob", () => {
  it("creates a refund bucket with REFUND reference type and 180-day expiry", async () => {
    const updateCalls: unknown[] = [];
    const tx = {
      job: {
        findUnique: async () => ({
          refundedTransaction: null,
          transaction: {
            amount: -500n,
            organizationId: "org-1",
            userId: "user-1",
          },
        }),
        update: async (args: unknown) => {
          updateCalls.push(args);
          return {};
        },
      },
    } as unknown as Prisma.TransactionClient;

    await jobRepository.refundJob("job-1", tx);

    assert.equal(updateCalls.length, 1);

    const updateCall = updateCalls[0] as {
      data: {
        refundedTransaction: {
          create: {
            amount: bigint;
            organization?: { connect: { id: string } };
            sourceCreditBucket: {
              create: {
                expiresAt: Date;
                referenceId: string;
                referenceType: CreditBucketReferenceType;
              };
            };
          };
        };
      };
      where: { id: string };
    };

    assert.equal(updateCall.where.id, "job-1");
    assert.equal(updateCall.data.refundedTransaction.create.amount, 500n);
    assert.equal(
      updateCall.data.refundedTransaction.create.sourceCreditBucket.create
        .referenceId,
      "job-1",
    );
    assert.equal(
      updateCall.data.refundedTransaction.create.sourceCreditBucket.create
        .referenceType,
      CreditBucketReferenceType.REFUND,
    );
    assert.equal(
      updateCall.data.refundedTransaction.create.organization?.connect.id,
      "org-1",
    );

    const expiryDate =
      updateCall.data.refundedTransaction.create.sourceCreditBucket.create
        .expiresAt;
    const expectedDeltaMs = REFUND_CREDITS_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    const deltaMs = expiryDate.getTime() - Date.now();

    assert.ok(deltaMs >= expectedDeltaMs - 2_000);
    assert.ok(deltaMs <= expectedDeltaMs + 2_000);
  });

  it("does nothing when job is already refunded", async () => {
    let updateCalled = false;
    const tx = {
      job: {
        findUnique: async () => ({
          refundedTransaction: { id: "refund-1" },
          transaction: {
            amount: -500n,
            organizationId: null,
            userId: "user-1",
          },
        }),
        update: async () => {
          updateCalled = true;
          return {};
        },
      },
    } as unknown as Prisma.TransactionClient;

    await jobRepository.refundJob("job-1", tx);

    assert.equal(updateCalled, false);
  });

  it("throws when the original transaction is missing", async () => {
    const tx = {
      job: {
        findUnique: async () => ({
          refundedTransaction: null,
          transaction: null,
        }),
        update: async () => ({}),
      },
    } as unknown as Prisma.TransactionClient;

    await assert.rejects(
      () => jobRepository.refundJob("job-1", tx),
      /Transaction not found/,
    );
  });
});
