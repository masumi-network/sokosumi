import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

import { CreditBucketReferenceType } from "../generated/prisma/client.js";
import { buildSignupBonusCreditReferenceId } from "./credit.js";
import { grantSignupBonusCredits } from "./signup-bonus-credits.js";

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
    const queryRawMock = vi.fn().mockResolvedValue([]);
    const executeRawMock = vi.fn().mockResolvedValue(1);
    const tx = {
      $queryRaw: queryRawMock,
      $executeRaw: executeRawMock,
    };

    const expiresAt = new Date("2026-08-05T00:00:00.000Z");
    const result = await grantSignupBonusCredits(
      {
        credits: 3000,
        expiresAt,
        userId: "user-1",
      },
      tx as never,
    );

    assert.equal(result.created, true);
    assert.equal(result.bucketId.charAt(14), "7");
    assert.equal(queryRawMock.mock.calls.length, 1);
    const [, ...lookupValues] = queryRawMock.mock.calls[0] ?? [];
    assert.ok(lookupValues.includes("user:user-1"));
    assert.ok(lookupValues.includes(CreditBucketReferenceType.SIGNUP_BONUS));

    assert.equal(executeRawMock.mock.calls.length, 2);
    const [, ...txValues] = executeRawMock.mock.calls[0] ?? [];
    assert.ok(txValues.includes(30_000_000_000_000n));
    assert.ok(txValues.includes("user-1"));
    const [, ...bucketValues] = executeRawMock.mock.calls[1] ?? [];
    assert.ok(bucketValues.includes(result.bucketId));
    assert.ok(bucketValues.includes("user:user-1"));
    assert.ok(bucketValues.includes(CreditBucketReferenceType.SIGNUP_BONUS));
    assert.ok(bucketValues.includes(expiresAt));
  });

  it("rejects non-positive credits", async () => {
    const tx = {
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn(),
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

  it.each([
    {
      label: "P2002",
      error: Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      }),
    },
    {
      label: "raw SQL P2010 (23505)",
      error: Object.assign(new Error("Raw query failed"), {
        code: "P2010",
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: "23505",
              kind: "UniqueConstraintViolation",
              constraint: {
                index: "credit_bucket_referenceId_referenceType_key",
              },
            },
          },
        },
      }),
    },
  ])(
    "returns the existing bucket when a concurrent create hits $label",
    async ({ error }) => {
      const queryRawMock = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "bucket-raced" }]);
      const executeRawMock = vi
        .fn()
        .mockResolvedValueOnce(1)
        .mockRejectedValueOnce(error);
      const tx = {
        $queryRaw: queryRawMock,
        $executeRaw: executeRawMock,
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
      assert.equal(executeRawMock.mock.calls.length, 2);
      assert.equal(queryRawMock.mock.calls.length, 2);
    },
  );

  it("is idempotent when the signup bonus bucket already exists", async () => {
    const queryRawMock = vi.fn().mockResolvedValue([{ id: "bucket-existing" }]);
    const executeRawMock = vi.fn();
    const tx = {
      $queryRaw: queryRawMock,
      $executeRaw: executeRawMock,
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
    assert.equal(executeRawMock.mock.calls.length, 0);
  });
});
