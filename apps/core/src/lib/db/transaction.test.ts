import { Prisma } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { serializableTransaction } from "./transaction";

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

  it("maps P2034 serialization failures to a 409 conflict", async () => {
    prismaTransactionMock.mockRejectedValueOnce(
      Object.assign(new Error("Transaction failed"), { code: "P2034" }),
    );

    const promise = serializableTransaction(
      vi.fn(),
      "Resource changed. Please retry.",
    );

    await expect(promise).rejects.toMatchObject({
      status: 409,
      message: "Resource changed. Please retry.",
    });
    await expect(promise).rejects.toBeInstanceOf(HTTPException);
  });

  it("rethrows non-conflict errors unchanged", async () => {
    const error = new Error("Connection lost");
    prismaTransactionMock.mockRejectedValueOnce(error);

    await expect(
      serializableTransaction(vi.fn(), "Conflict message"),
    ).rejects.toBe(error);
  });
});
