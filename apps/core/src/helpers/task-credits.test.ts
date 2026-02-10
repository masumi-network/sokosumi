import { creditBucketRepository } from "@sokosumi/database/repositories";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTaskEventTransaction } from "./task-credits";

vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: {
    prepareConsumption: vi.fn(),
  },
}));

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
      credits: 5,
      tx: tx as unknown as Parameters<
        typeof createTaskEventTransaction
      >[0]["tx"],
    });

    expect(result).toBe("trx_1");
    expect(prepareConsumption).toHaveBeenCalledWith(
      "user_1",
      null,
      expect.any(BigInt),
      tx,
    );

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
      credits: 5,
      tx: tx as unknown as Parameters<
        typeof createTaskEventTransaction
      >[0]["tx"],
    });

    expect(result).toBe("trx_2");
    expect(prepareConsumption).toHaveBeenCalledWith(
      "user_1",
      "org_1",
      expect.any(BigInt),
      tx,
    );

    const createCall = vi.mocked(tx.transaction.create).mock.calls[0]?.[0];
    expect(createCall?.data).toEqual(
      expect.objectContaining({
        organization: { connect: { id: "org_1" } },
      }),
    );
  });

  it("returns null when credits are zero", async () => {
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
      credits: 0,
      tx: tx as unknown as Parameters<
        typeof createTaskEventTransaction
      >[0]["tx"],
    });

    expect(result).toBeNull();
    expect(prepareConsumption).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });
});
