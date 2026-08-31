import { CreditBucketReferenceType } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { buildCompensatingRefundTransactionCreate } from "./compensating-refund";

describe("buildCompensatingRefundTransactionCreate", () => {
  it("stamps an org refund bucket as org-owned and leaves the transaction without an actor", () => {
    const create = buildCompensatingRefundTransactionCreate({
      amount: 500n,
      actorUserId: "user-1",
      organizationId: "org-1",
      referenceId: "job-1",
    });

    expect(create).toEqual({
      amount: 500n,
      organizationId: "org-1",
      userId: null,
      sourceCreditBucket: {
        create: {
          amount: 500n,
          referenceId: "job-1",
          referenceType: CreditBucketReferenceType.REFUND,
          expiresAt: null,
          userId: null,
          organizationId: "org-1",
        },
      },
    });
  });

  it("stamps a personal refund bucket with the actor and a null organizationId", () => {
    const create = buildCompensatingRefundTransactionCreate({
      amount: 250n,
      actorUserId: "user-1",
      organizationId: null,
      referenceId: "task-payment:claim-1",
    });

    expect(create).toEqual({
      amount: 250n,
      organizationId: null,
      userId: "user-1",
      sourceCreditBucket: {
        create: {
          amount: 250n,
          referenceId: "task-payment:claim-1",
          referenceType: CreditBucketReferenceType.REFUND,
          expiresAt: null,
          userId: "user-1",
          organizationId: null,
        },
      },
    });
  });
});
