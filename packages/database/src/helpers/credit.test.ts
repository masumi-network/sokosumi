import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { splitAmountEvenlyWithRemainderRotation } from "./credit.js";

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

    assert.deepEqual(firstBucket.allocations, [{ memberId: "user-a", amount: 1n }]);
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
