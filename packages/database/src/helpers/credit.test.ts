import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildOrganizationInvoiceCreditReferenceId,
  buildUserInvoiceCreditReferenceId,
  FREE_CREDITS_EXPIRY_DAYS,
  getCreditExpiryDate,
  splitAmountEvenlyWithRemainderRotation,
} from "./credit.js";

describe("splitAmountEvenlyWithRemainderRotation", () => {
  it("returns empty allocations for non-positive amounts or empty members", () => {
    assert.deepEqual(
      splitAmountEvenlyWithRemainderRotation({
        memberIds: [],
        totalAmount: 10n,
      }),
      {
        allocations: [],
        nextRemainderOffset: 0,
      },
    );

    assert.deepEqual(
      splitAmountEvenlyWithRemainderRotation({
        memberIds: ["user-a", "user-b"],
        totalAmount: 0n,
      }),
      {
        allocations: [],
        nextRemainderOffset: 0,
      },
    );
  });

  it("splits evenly when total is divisible by member count", () => {
    const result = splitAmountEvenlyWithRemainderRotation({
      memberIds: ["user-a", "user-b", "user-c"],
      totalAmount: 12n,
    });

    assert.deepEqual(result.allocations, [
      { memberId: "user-a", amount: 4n },
      { memberId: "user-b", amount: 4n },
      { memberId: "user-c", amount: 4n },
    ]);
    assert.equal(result.nextRemainderOffset, 0);
  });

  it("rotates remainder allocation across sequential buckets", () => {
    const members = ["user-a", "user-b"];

    const firstBucket = splitAmountEvenlyWithRemainderRotation({
      memberIds: members,
      totalAmount: 1n,
      remainderOffset: 0,
    });
    const secondBucket = splitAmountEvenlyWithRemainderRotation({
      memberIds: members,
      totalAmount: 1n,
      remainderOffset: firstBucket.nextRemainderOffset,
    });

    assert.deepEqual(firstBucket.allocations, [
      { memberId: "user-a", amount: 1n },
    ]);
    assert.equal(firstBucket.nextRemainderOffset, 1);
    assert.deepEqual(secondBucket.allocations, [
      { memberId: "user-b", amount: 1n },
    ]);
    assert.equal(secondBucket.nextRemainderOffset, 0);
  });

  it("normalizes negative remainder offsets", () => {
    const result = splitAmountEvenlyWithRemainderRotation({
      memberIds: ["user-a", "user-b", "user-c"],
      totalAmount: 2n,
      remainderOffset: -1,
    });

    assert.deepEqual(result.allocations, [
      { memberId: "user-a", amount: 1n },
      { memberId: "user-c", amount: 1n },
    ]);
    assert.equal(result.nextRemainderOffset, 1);
  });
});

describe("invoice credit reference builders", () => {
  it("builds user invoice reference ids", () => {
    assert.equal(
      buildUserInvoiceCreditReferenceId("user-1", "in_123", "subscription"),
      "user:user-1:in_123:subscription",
    );
    assert.equal(
      buildUserInvoiceCreditReferenceId("user-1", "in_123", "topup"),
      "user:user-1:in_123:topup",
    );
  });

  it("builds organization invoice reference ids", () => {
    assert.equal(
      buildOrganizationInvoiceCreditReferenceId("org-1", "in_123", "topup"),
      "org:org-1:in_123:topup",
    );
  });

  it("throws when required values are missing", () => {
    assert.throws(
      () => buildUserInvoiceCreditReferenceId("", "in_123", "subscription"),
      /userId is required/,
    );
    assert.throws(
      () => buildOrganizationInvoiceCreditReferenceId("org-1", "", "topup"),
      /invoiceId is required/,
    );
  });
});

describe("credit expiration policy", () => {
  it("defines expected expiration day constants", () => {
    assert.equal(FREE_CREDITS_EXPIRY_DAYS, 30);
  });

  it("calculates expiration date from a base date and day count", () => {
    const baseDate = new Date("2026-02-27T00:00:00.000Z");
    const expiryDate = getCreditExpiryDate(baseDate, 30);
    assert.equal(expiryDate.toISOString(), "2026-03-29T00:00:00.000Z");
  });

  it("throws for invalid day values", () => {
    assert.throws(() => getCreditExpiryDate(new Date(), -1), /Expiry days/);
    assert.throws(() => getCreditExpiryDate(new Date(), 1.5), /Expiry days/);
  });
});
