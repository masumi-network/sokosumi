import { describe, expect, it } from "vitest";

import {
  isCreditBucketReferenceUniqueConstraintError,
  isPrismaForeignKeyViolation,
  isPrismaRecordNotFoundError,
  isPrismaTransactionConflict,
  isProjectIdentifierUniqueConstraintError,
} from "@/helpers/prisma";

describe("isPrismaForeignKeyViolation", () => {
  it("detects Prisma P2003 foreign-key errors", () => {
    expect(
      isPrismaForeignKeyViolation(
        Object.assign(new Error("Foreign key constraint failed"), {
          code: "P2003",
        }),
      ),
    ).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isPrismaForeignKeyViolation(new Error("connection lost"))).toBe(
      false,
    );
    expect(
      isPrismaForeignKeyViolation(
        Object.assign(new Error("unique"), { code: "P2002" }),
      ),
    ).toBe(false);
  });
});

describe("isPrismaRecordNotFoundError", () => {
  it("detects Prisma P2025 record-not-found errors", () => {
    expect(
      isPrismaRecordNotFoundError(
        Object.assign(new Error("No record was found for an update."), {
          code: "P2025",
        }),
      ),
    ).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isPrismaRecordNotFoundError(new Error("connection lost"))).toBe(
      false,
    );
    expect(
      isPrismaRecordNotFoundError(
        Object.assign(new Error("unique"), { code: "P2002" }),
      ),
    ).toBe(false);
  });
});

describe("isPrismaTransactionConflict", () => {
  it("detects Prisma P2034 serialization failures", () => {
    expect(
      isPrismaTransactionConflict(
        Object.assign(new Error("serialization failure"), { code: "P2034" }),
      ),
    ).toBe(true);
  });

  it("detects DriverAdapterError write conflicts", () => {
    expect(
      isPrismaTransactionConflict(
        Object.assign(new Error("TransactionWriteConflict"), {
          name: "DriverAdapterError",
        }),
      ),
    ).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isPrismaTransactionConflict(new Error("connection lost"))).toBe(
      false,
    );
  });
});

describe("isProjectIdentifierUniqueConstraintError", () => {
  it("detects a P2002 on the composite workspace identifier", () => {
    expect(
      isProjectIdentifierUniqueConstraintError({
        code: "P2002",
        meta: { target: ["workspaceId", "identifier"] },
      }),
    ).toBe(true);
  });

  it("detects the driver-adapter constraint shape", () => {
    expect(
      isProjectIdentifierUniqueConstraintError({
        code: "P2002",
        meta: {
          driverAdapterError: {
            cause: {
              constraint: { fields: ["workspaceId", "identifier"] },
            },
          },
        },
      }),
    ).toBe(true);
  });

  it("ignores other unique violations", () => {
    expect(
      isProjectIdentifierUniqueConstraintError({
        code: "P2002",
        meta: { target: ["slug"] },
      }),
    ).toBe(false);
    expect(isProjectIdentifierUniqueConstraintError(new Error("boom"))).toBe(
      false,
    );
  });
});

describe("isCreditBucketReferenceUniqueConstraintError", () => {
  it("detects Prisma P2002 on referenceId + referenceType", () => {
    expect(
      isCreditBucketReferenceUniqueConstraintError({
        code: "P2002",
        meta: { target: ["referenceId", "referenceType"] },
      }),
    ).toBe(true);
  });

  it("detects raw SQL P2010 (23505) on credit_bucket_referenceId_referenceType_key", () => {
    expect(
      isCreditBucketReferenceUniqueConstraintError({
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
    ).toBe(true);
  });

  it("rejects raw SQL P2010 on other constraints or non-23505 SQLSTATEs", () => {
    expect(
      isCreditBucketReferenceUniqueConstraintError({
        code: "P2010",
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: "23505",
              kind: "UniqueConstraintViolation",
              constraint: { index: "Transaction_pkey" },
            },
          },
        },
      }),
    ).toBe(false);
    expect(
      isCreditBucketReferenceUniqueConstraintError({
        code: "P2010",
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: "23503",
              constraint: {
                index: "credit_bucket_referenceId_referenceType_key",
              },
            },
          },
        },
      }),
    ).toBe(false);
  });
});
