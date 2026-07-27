import { describe, expect, it } from "vitest";

import {
  isPrismaRecordNotFoundError,
  isPrismaTransactionConflict,
} from "@/helpers/prisma";

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
