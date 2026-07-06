import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

import { CreditBucketReferenceType } from "../../generated/prisma/client.js";
import { buildSignupBonusCreditReferenceId } from "../credit.js";
import { grantSignupBonusCredits } from "../signup-bonus-credits.js";

describe("buildSignupBonusCreditReferenceId", () => {
  it("returns user:{userId}", () => {
    assert.equal(buildSignupBonusCreditReferenceId("user-1"), "user:user-1");
  });

  it("rejects empty userId", () => {
    assert.throws(
      () => buildSignupBonusCreditReferenceId(""),
      /userId is required/,
    );
  });
});

describe("grantSignupBonusCredits", () => {
  it("creates a transaction and signup bonus bucket", async () => {
    const findUniqueMock = vi.fn().mockResolvedValue(null);
    const createMock = vi.fn().mockResolvedValue({
      sourceCreditBucket: { id: "bucket-1" },
    });
    const tx = {
      creditBucket: { findUnique: findUniqueMock },
      transaction: { create: createMock },
    };

    const expiresAt = new Date("2026-08-05T00:00:00.000Z");
    const result = await grantSignupBonusCredits(
      {
        credits: 3000,
        expiresAt,
        referenceNote: "Signup bonus",
        userId: "user-1",
      },
      tx as never,
    );

    assert.deepEqual(result, { bucketId: "bucket-1", created: true });
    assert.deepEqual(findUniqueMock.mock.calls[0]?.[0].where, {
      referenceId_referenceType: {
        referenceId: "user:user-1",
        referenceType: CreditBucketReferenceType.SIGNUP_BONUS,
      },
    });
    assert.equal(
      createMock.mock.calls[0]?.[0].data.amount,
      30_000_000_000_000n,
    );
    assert.equal(
      createMock.mock.calls[0]?.[0].data.sourceCreditBucket.create.referenceId,
      "user:user-1",
    );
    assert.equal(
      createMock.mock.calls[0]?.[0].data.sourceCreditBucket.create
        .referenceType,
      CreditBucketReferenceType.SIGNUP_BONUS,
    );
    assert.equal(
      createMock.mock.calls[0]?.[0].data.sourceCreditBucket.create
        .referenceNote,
      "Signup bonus",
    );
    assert.equal(
      createMock.mock.calls[0]?.[0].data.sourceCreditBucket.create.expiresAt,
      expiresAt,
    );
  });

  it("rejects non-positive credits", async () => {
    const tx = {
      creditBucket: { findUnique: vi.fn() },
      transaction: { create: vi.fn() },
    };

    await assert.rejects(
      () =>
        grantSignupBonusCredits(
          {
            credits: 0,
            expiresAt: null,
            userId: "user-1",
          },
          tx as never,
        ),
      /Signup bonus credits must be a positive integer/,
    );
  });

  it("returns the existing bucket when a concurrent create hits P2002", async () => {
    const findUniqueMock = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "bucket-raced" });
    const createMock = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );
    const tx = {
      creditBucket: { findUnique: findUniqueMock },
      transaction: { create: createMock },
    };

    const result = await grantSignupBonusCredits(
      {
        credits: 3000,
        expiresAt: null,
        userId: "user-1",
      },
      tx as never,
    );

    assert.deepEqual(result, {
      bucketId: "bucket-raced",
      created: false,
    });
    assert.equal(createMock.mock.calls.length, 1);
    assert.equal(findUniqueMock.mock.calls.length, 2);
  });

  it("is idempotent when the signup bonus bucket already exists", async () => {
    const findUniqueMock = vi.fn().mockResolvedValue({ id: "bucket-existing" });
    const createMock = vi.fn();
    const tx = {
      creditBucket: { findUnique: findUniqueMock },
      transaction: { create: createMock },
    };

    const result = await grantSignupBonusCredits(
      {
        credits: 3000,
        expiresAt: null,
        userId: "user-1",
      },
      tx as never,
    );

    assert.deepEqual(result, {
      bucketId: "bucket-existing",
      created: false,
    });
    assert.equal(createMock.mock.calls.length, 0);
  });
});
