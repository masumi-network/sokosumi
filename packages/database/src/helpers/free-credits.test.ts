import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

import { CreditBucketReferenceType } from "../generated/prisma/client.js";
import { buildFreeCreditReferenceId } from "./credit.js";
import { grantFreeCredits } from "./free-credits.js";

describe("buildFreeCreditReferenceId", () => {
  it("returns user:{userId}:free:{grantId}", () => {
    assert.equal(
      buildFreeCreditReferenceId({
        grantId: "grant-1",
        targetId: "user-1",
        targetType: "user",
      }),
      "user:user-1:free:grant-1",
    );
  });

  it("returns org:{orgId}:free:{grantId}", () => {
    assert.equal(
      buildFreeCreditReferenceId({
        grantId: "grant-2",
        targetId: "org-1",
        targetType: "organization",
      }),
      "org:org-1:free:grant-2",
    );
  });
});

describe("grantFreeCredits", () => {
  it("creates a user-scoped free credit bucket", async () => {
    const createMock = vi.fn().mockResolvedValue({
      sourceCreditBucket: { id: "bucket-1" },
    });
    const tx = {
      transaction: { create: createMock },
    };

    const expiresAt = new Date("2026-08-05T00:00:00.000Z");
    const result = await grantFreeCredits(
      {
        credits: 500,
        expiresAt,
        grantId: "grant-1",
        organizationId: null,
        referenceNote: "Goodwill gesture",
        targetId: "user-1",
        targetType: "user",
        transactionUserId: "user-1",
      },
      tx as never,
    );

    assert.deepEqual(result, { bucketId: "bucket-1" });
    assert.equal(
      createMock.mock.calls[0]?.[0].data.sourceCreditBucket.create.referenceId,
      "user:user-1:free:grant-1",
    );
    assert.equal(
      createMock.mock.calls[0]?.[0].data.sourceCreditBucket.create
        .referenceType,
      CreditBucketReferenceType.FREE,
    );
    assert.equal(
      createMock.mock.calls[0]?.[0].data.sourceCreditBucket.create
        .referenceNote,
      "Goodwill gesture",
    );
    assert.equal(
      createMock.mock.calls[0]?.[0].data.sourceCreditBucket.create.userId,
      "user-1",
    );
    assert.equal(
      createMock.mock.calls[0]?.[0].data.sourceCreditBucket.create
        .organizationId,
      null,
    );
    assert.equal(createMock.mock.calls[0]?.[0].data.userId, "user-1");
  });

  it("creates an organization-scoped free credit bucket", async () => {
    const createMock = vi.fn().mockResolvedValue({
      sourceCreditBucket: { id: "bucket-org" },
    });
    const tx = {
      transaction: { create: createMock },
    };

    const result = await grantFreeCredits(
      {
        credits: 1000,
        expiresAt: null,
        grantId: "grant-org",
        organizationId: "org-1",
        referenceNote: null,
        targetId: "org-1",
        targetType: "organization",
        transactionUserId: null,
      },
      tx as never,
    );

    assert.deepEqual(result, { bucketId: "bucket-org" });
    assert.equal(
      createMock.mock.calls[0]?.[0].data.sourceCreditBucket.create.referenceId,
      "org:org-1:free:grant-org",
    );
    assert.equal(
      createMock.mock.calls[0]?.[0].data.sourceCreditBucket.create.userId,
      null,
    );
    assert.equal(
      createMock.mock.calls[0]?.[0].data.sourceCreditBucket.create
        .organizationId,
      "org-1",
    );
    assert.equal(createMock.mock.calls[0]?.[0].data.userId, null);
    assert.equal(createMock.mock.calls[0]?.[0].data.organizationId, "org-1");
  });

  it("rejects non-positive credits", async () => {
    const tx = {
      transaction: { create: vi.fn() },
    };

    await assert.rejects(
      () =>
        grantFreeCredits(
          {
            credits: 0,
            expiresAt: null,
            grantId: "grant-1",
            organizationId: null,
            referenceNote: null,
            targetId: "user-1",
            targetType: "user",
            transactionUserId: "user-1",
          },
          tx as never,
        ),
      /Free credits must be a positive integer/,
    );
  });

  it("rejects user grants without a transaction actor", async () => {
    const createMock = vi.fn();
    const tx = {
      transaction: { create: createMock },
    };

    await assert.rejects(
      () =>
        grantFreeCredits(
          {
            credits: 100,
            expiresAt: null,
            grantId: "grant-1",
            organizationId: null,
            referenceNote: null,
            targetId: "user-1",
            targetType: "user",
            transactionUserId: null,
          },
          tx as never,
        ),
      /User free credits require a transaction actor user id/,
    );
    assert.equal(createMock.mock.calls.length, 0);
  });

  it("rejects organization grants that stamp a transaction actor", async () => {
    const createMock = vi.fn();
    const tx = {
      transaction: { create: createMock },
    };

    await assert.rejects(
      () =>
        grantFreeCredits(
          {
            credits: 100,
            expiresAt: null,
            grantId: "grant-org",
            organizationId: "org-1",
            referenceNote: null,
            targetId: "org-1",
            targetType: "organization",
            transactionUserId: "user-1",
          },
          tx as never,
        ),
      /Organization free credits must not stamp a transaction actor/,
    );
    assert.equal(createMock.mock.calls.length, 0);
  });
});
