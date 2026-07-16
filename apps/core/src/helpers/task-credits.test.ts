import {
  creditBucketRepository,
  InsufficientBalanceError,
} from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTaskEventTransaction,
  isInsufficientBalanceError,
} from "./task-credits";

vi.mock("@sokosumi/database/repositories", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/repositories")>();
  return {
    ...actual,
    creditBucketRepository: {
      prepareConsumption: vi.fn(),
    },
  };
});

describe("createTaskEventTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("consumes personal credits when organizationId is null", async () => {
    const prepareConsumption = vi.mocked(
      creditBucketRepository.prepareConsumption,
    );
    prepareConsumption.mockResolvedValue([
      { bucketId: "bucket_1", amount: 100n },
    ]);

    const tx = {
      transaction: {
        create: vi.fn().mockResolvedValue({ id: "trx_1" }),
      },
    } as const;

    const result = await createTaskEventTransaction({
      userId: "user_1",
      organizationId: null,
      cents: 500n,
      tx: tx as unknown as Parameters<
        typeof createTaskEventTransaction
      >[0]["tx"],
    });

    expect(result).toBe("trx_1");
    expect(prepareConsumption).toHaveBeenCalledWith("user_1", null, 500n, tx);

    const createCall = vi.mocked(tx.transaction.create).mock.calls[0]?.[0];
    expect(createCall?.data).not.toHaveProperty("organization");
  });

  it("consumes organization credits when organizationId is set", async () => {
    const prepareConsumption = vi.mocked(
      creditBucketRepository.prepareConsumption,
    );
    prepareConsumption.mockResolvedValue([
      { bucketId: "bucket_1", amount: 100n },
    ]);

    const tx = {
      transaction: {
        create: vi.fn().mockResolvedValue({ id: "trx_2" }),
      },
    } as const;

    const result = await createTaskEventTransaction({
      userId: "user_1",
      organizationId: "org_1",
      cents: 500n,
      tx: tx as unknown as Parameters<
        typeof createTaskEventTransaction
      >[0]["tx"],
    });

    expect(result).toBe("trx_2");
    expect(prepareConsumption).toHaveBeenCalledWith(
      "user_1",
      "org_1",
      500n,
      tx,
    );

    const createCall = vi.mocked(tx.transaction.create).mock.calls[0]?.[0];
    expect(createCall?.data).toEqual(
      expect.objectContaining({
        organization: { connect: { id: "org_1" } },
      }),
    );
  });

  it("returns null when cents are zero", async () => {
    const prepareConsumption = vi.mocked(
      creditBucketRepository.prepareConsumption,
    );

    const tx = {
      transaction: {
        create: vi.fn(),
      },
    } as const;

    const result = await createTaskEventTransaction({
      userId: "user_1",
      organizationId: null,
      cents: 0n,
      tx: tx as unknown as Parameters<
        typeof createTaskEventTransaction
      >[0]["tx"],
    });

    expect(result).toBeNull();
    expect(prepareConsumption).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it("throws when credits are insufficient", async () => {
    const prepareConsumption = vi.mocked(
      creditBucketRepository.prepareConsumption,
    );
    prepareConsumption.mockRejectedValue(
      new InsufficientBalanceError(500n, 200n),
    );

    const tx = {
      transaction: {
        create: vi.fn(),
      },
    } as const;

    await expect(
      createTaskEventTransaction({
        userId: "user_1",
        organizationId: null,
        cents: 500n,
        tx: tx as unknown as Parameters<
          typeof createTaskEventTransaction
        >[0]["tx"],
      }),
    ).rejects.toMatchObject({
      status: 422,
      message:
        "Insufficient balance: tried to consume 500 but only 200 available",
      cause: { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
    } satisfies Pick<HTTPException, "status" | "message" | "cause">);

    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it("detects insufficient-balance errors by kind", () => {
    expect(
      isInsufficientBalanceError(
        new HTTPException(422, {
          message: "Insufficient balance",
          cause: { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
        }),
      ),
    ).toBe(true);

    expect(
      isInsufficientBalanceError(
        new HTTPException(422, { message: "Insufficient balance" }),
      ),
    ).toBe(false);

    expect(
      isInsufficientBalanceError(
        new HTTPException(422, {
          message: "Other error",
          cause: { kind: "other" },
        }),
      ),
    ).toBe(false);
  });
});
