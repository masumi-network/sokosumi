import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { refundJob } from "./job-refund";

describe("refundJob", () => {
  it("creates a refund bucket with REFUND reference type and no expiry", async () => {
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

    await refundJob("job-1", tx);

    expect(updateCalls).toHaveLength(1);

    const updateCall = updateCalls[0] as {
      data: {
        refundedTransaction: {
          create: {
            amount: bigint;
            organization?: { connect: { id: string } };
            organizationId?: string | null;
            user?: { connect: { id: string } };
            userId?: string | null;
            sourceCreditBucket: {
              create: {
                expiresAt: Date | null;
                organizationId?: string | null;
                referenceId: string;
                referenceType: CreditBucketReferenceType;
                user?: { connect: { id: string } };
                userId?: string | null;
              };
            };
          };
        };
      };
      where: { id: string };
    };

    expect(updateCall.where.id).toBe("job-1");
    expect(updateCall.data.refundedTransaction.create.amount).toBe(500n);
    expect(updateCall.data.refundedTransaction.create.user).toBeUndefined();
    expect(updateCall.data.refundedTransaction.create.userId).toBeNull();
    expect(updateCall.data.refundedTransaction.create.organizationId).toBe(
      "org-1",
    );
    expect(
      updateCall.data.refundedTransaction.create.sourceCreditBucket.create
        .referenceId,
    ).toBe("job-1");
    expect(
      updateCall.data.refundedTransaction.create.sourceCreditBucket.create
        .referenceType,
    ).toBe(CreditBucketReferenceType.REFUND);
    expect(
      updateCall.data.refundedTransaction.create.organization,
    ).toBeUndefined();
    expect(
      updateCall.data.refundedTransaction.create.sourceCreditBucket.create
        .userId,
    ).toBeNull();
    expect(
      updateCall.data.refundedTransaction.create.sourceCreditBucket.create.user,
    ).toBeUndefined();
    expect(
      updateCall.data.refundedTransaction.create.sourceCreditBucket.create
        .organizationId,
    ).toBe("org-1");

    expect(
      updateCall.data.refundedTransaction.create.sourceCreditBucket.create
        .expiresAt,
    ).toBeNull();
  });

  it("stamps a personal refund bucket with the actor", async () => {
    const updateCalls: unknown[] = [];
    const tx = {
      job: {
        findUnique: async () => ({
          refundedTransaction: null,
          transaction: {
            amount: -500n,
            organizationId: null,
            userId: "user-1",
          },
        }),
        update: async (args: unknown) => {
          updateCalls.push(args);
          return {};
        },
      },
    } as unknown as Prisma.TransactionClient;

    await refundJob("job-1", tx);

    const updateCall = updateCalls[0] as {
      data: {
        refundedTransaction: {
          create: {
            organization?: { connect: { id: string } };
            user: { connect: { id: string } };
            sourceCreditBucket: {
              create: {
                organizationId?: string | null;
                user?: { connect: { id: string } };
                userId?: string | null;
              };
            };
          };
        };
      };
    };

    expect(updateCall.data.refundedTransaction.create.user.connect.id).toBe(
      "user-1",
    );
    expect(
      updateCall.data.refundedTransaction.create.organization,
    ).toBeUndefined();
    expect(
      updateCall.data.refundedTransaction.create.sourceCreditBucket.create
        .userId,
    ).toBe("user-1");
    expect(
      updateCall.data.refundedTransaction.create.sourceCreditBucket.create
        .organizationId,
    ).toBeNull();
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

    await refundJob("job-1", tx);

    expect(updateCalled).toBe(false);
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

    await expect(refundJob("job-1", tx)).rejects.toThrow(
      /Transaction not found/,
    );
  });
});
