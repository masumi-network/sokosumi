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

    expect(create.amount).toBe(500n);
    expect("user" in create ? create.user : undefined).toBeUndefined();
    expect("userId" in create ? create.userId : undefined).toBeNull();
    expect("organizationId" in create ? create.organizationId : undefined).toBe(
      "org-1",
    );
    expect(create.sourceCreditBucket).toEqual({
      create: {
        amount: 500n,
        referenceId: "job-1",
        referenceType: CreditBucketReferenceType.REFUND,
        expiresAt: null,
        userId: null,
        organizationId: "org-1",
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

    expect(create.amount).toBe(250n);
    expect("user" in create ? create.user : undefined).toEqual({
      connect: { id: "user-1" },
    });
    expect(
      "organization" in create ? create.organization : undefined,
    ).toBeUndefined();
    expect(create.sourceCreditBucket).toEqual({
      create: {
        amount: 250n,
        referenceId: "task-payment:claim-1",
        referenceType: CreditBucketReferenceType.REFUND,
        expiresAt: null,
        userId: "user-1",
        organizationId: null,
      },
    });
  });
});
