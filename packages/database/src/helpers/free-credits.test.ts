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
    const executeRawMock = vi.fn().mockResolvedValue(1);
    const tx = {
      $executeRaw: executeRawMock,
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

    assert.equal(result.bucketId.charAt(14), "7");
    assert.equal(executeRawMock.mock.calls.length, 2);
    const [, ...txValues] = executeRawMock.mock.calls[0] ?? [];
    assert.equal(txValues[5], "user-1");
    assert.equal(txValues[6], null);
    const [, ...bucketValues] = executeRawMock.mock.calls[1] ?? [];
    assert.equal(bucketValues[1], result.bucketId);
    assert.equal(bucketValues[5], expiresAt);
    assert.equal(bucketValues[7], "user:user-1:free:grant-1");
    assert.equal(bucketValues[8], CreditBucketReferenceType.FREE);
    assert.equal(bucketValues[10], "Goodwill gesture");
    assert.equal(bucketValues[12], "user-1");
    assert.equal(bucketValues[13], null);
    assert.equal(bucketValues[14], null);
  });

  it("creates an organization-scoped free credit bucket", async () => {
    const executeRawMock = vi.fn().mockResolvedValue(1);
    const tx = {
      $executeRaw: executeRawMock,
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

    assert.equal(result.bucketId.charAt(14), "7");
    assert.equal(executeRawMock.mock.calls.length, 2);
    const [, ...txValues] = executeRawMock.mock.calls[0] ?? [];
    assert.equal(txValues[5], null);
    assert.equal(txValues[6], "org-1");
    const [, ...bucketValues] = executeRawMock.mock.calls[1] ?? [];
    assert.equal(bucketValues[7], "org:org-1:free:grant-org");
    assert.equal(bucketValues[12], null);
    assert.equal(bucketValues[13], "org-1");
    assert.equal(bucketValues[14], null);
  });

  it("scopes an organization grant to a Project", async () => {
    const executeRawMock = vi.fn().mockResolvedValue(1);

    await grantFreeCredits(
      {
        credits: 10_000,
        expiresAt: null,
        grantId: "grant-project",
        organizationId: "org-1",
        projectId: "project-1",
        referenceNote: null,
        targetId: "org-1",
        targetType: "organization",
        transactionUserId: null,
      },
      { $executeRaw: executeRawMock } as never,
    );

    const [, ...bucketValues] = executeRawMock.mock.calls[1] ?? [];
    assert.equal(bucketValues[14], "project-1");
  });

  it("rejects non-positive credits", async () => {
    const tx = {
      $executeRaw: vi.fn(),
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
    const executeRawMock = vi.fn();
    const tx = {
      $executeRaw: executeRawMock,
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
    assert.equal(executeRawMock.mock.calls.length, 0);
  });

  it("rejects organization grants that stamp a transaction actor", async () => {
    const executeRawMock = vi.fn();
    const tx = {
      $executeRaw: executeRawMock,
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
    assert.equal(executeRawMock.mock.calls.length, 0);
  });
});
