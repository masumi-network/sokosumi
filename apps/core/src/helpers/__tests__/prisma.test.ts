import { describe, expect, it } from "vitest";

import { isPrismaTransactionConflict } from "@/helpers/prisma";

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
