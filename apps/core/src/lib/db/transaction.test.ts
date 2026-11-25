import { Prisma } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONCURRENCY_CONFLICT_KIND,
  retriedTransaction,
  serializableTransaction,
} from "./transaction";

const { prismaTransactionMock } = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

describe("serializableTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the callback in a Serializable transaction and returns its result", async () => {
    const callback = vi.fn().mockResolvedValue("result");
    prismaTransactionMock.mockImplementation(
      async (cb: () => unknown) => await cb(),
    );

    const result = await serializableTransaction(callback, "Conflict message");

    expect(result).toBe("result");
    expect(prismaTransactionMock).toHaveBeenCalledWith(callback, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it("passes a caller's wait and timeout to the transaction", async () => {
    const callback = vi.fn().mockResolvedValue("result");
    prismaTransactionMock.mockImplementation(
      async (cb: () => unknown) => await cb(),
    );

    await serializableTransaction(callback, "Conflict message", {
      maxWait: 10_000,
      timeout: 30_000,
    });

    expect(prismaTransactionMock).toHaveBeenCalledWith(callback, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    });
  });

  it("retries a serialization failure before succeeding", async () => {
    prismaTransactionMock
      .mockRejectedValueOnce(
        Object.assign(new Error("Transaction failed"), { code: "P2034" }),
      )
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            "Invalid `prisma.$queryRaw()` invocation: driverAdapterError: DriverAdapterError: TransactionWriteConflict",
          ),
          { name: "PrismaClientKnownRequestError" },
        ),
      )
      .mockResolvedValueOnce("result");

    await expect(
      serializableTransaction(vi.fn(), "Conflict message"),
    ).resolves.toBe("result");
    expect(prismaTransactionMock).toHaveBeenCalledTimes(3);
  });

  it("retries a raw-query SQLSTATE 40001 serialization failure", async () => {
    prismaTransactionMock
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            "Invalid `prisma.$queryRaw()` invocation: Raw query failed. Code: `40001`. Message: `could not serialize access due to concurrent update`",
          ),
          { name: "PrismaClientKnownRequestError", code: "P2010" },
        ),
      )
      .mockResolvedValueOnce("result");

    await expect(
      serializableTransaction(vi.fn(), "Conflict message"),
    ).resolves.toBe("result");
    expect(prismaTransactionMock).toHaveBeenCalledTimes(2);
  });

  it("retries a raw-query SQLSTATE 40P01 deadlock at the default isolation level", async () => {
    const callback = vi.fn();
    prismaTransactionMock
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            "Invalid `prisma.$queryRaw()` invocation:\n\n\nRaw query failed. Code: `40P01`. Message: `deadlock detected`",
          ),
          { name: "PrismaClientKnownRequestError", code: "P2010" },
        ),
      )
      .mockResolvedValueOnce("result");

    await expect(
      retriedTransaction(callback, "Conflict message"),
    ).resolves.toBe("result");
    expect(prismaTransactionMock).toHaveBeenCalledTimes(2);
    expect(prismaTransactionMock).toHaveBeenLastCalledWith(callback, undefined);
  });

  it("maps P2034 serialization failures to a 409 conflict", async () => {
    prismaTransactionMock.mockRejectedValue(
      Object.assign(new Error("Transaction failed"), { code: "P2034" }),
    );

    const promise = serializableTransaction(
      vi.fn(),
      "Resource changed. Please retry.",
    );

    await expect(promise).rejects.toMatchObject({
      status: 409,
      message: "Resource changed. Please retry.",
      cause: { kind: CONCURRENCY_CONFLICT_KIND },
    });
    await expect(promise).rejects.toBeInstanceOf(HTTPException);
  });

  it("maps DriverAdapterError write conflicts to a 409 conflict", async () => {
    prismaTransactionMock.mockRejectedValue(
      Object.assign(new Error("TransactionWriteConflict"), {
        name: "DriverAdapterError",
      }),
    );

    const promise = serializableTransaction(
      vi.fn(),
      "Resource changed. Please retry.",
    );

    await expect(promise).rejects.toMatchObject({
      status: 409,
      message: "Resource changed. Please retry.",
      cause: { kind: CONCURRENCY_CONFLICT_KIND },
    });
  });

  it("rethrows non-conflict errors unchanged", async () => {
    const error = new Error("Connection lost");
    prismaTransactionMock.mockRejectedValueOnce(error);

    await expect(
      serializableTransaction(vi.fn(), "Conflict message"),
    ).rejects.toBe(error);
  });
});
