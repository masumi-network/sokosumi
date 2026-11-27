import type { Prisma } from "@sokosumi/database";
import {
  creditBucketRepository,
  InsufficientBalanceError,
} from "@sokosumi/database/repositories";
import { describe, expect, it, vi } from "vitest";

import type { NetworkScope } from "@/lib/db/network-scope";

import { spend } from "./spend";

const scope = { network: "mainnet" } as NetworkScope;
const payer = { userId: null, organizationId: "org-1", projectId: "project-1" };

function openTransaction() {
  const create = vi.fn(async () => ({ id: "debit-1" }));
  const tx = { transaction: { create } } as unknown as Prisma.TransactionClient;
  return { tx, create };
}

describe("spend", () => {
  it("writes the debit on the caller's transaction and returns it as charged in full", async () => {
    const consumptions = [
      { bucketId: "bucket-project", amount: 40n },
      { bucketId: "bucket-pool", amount: 60n },
    ];
    const prepare = vi
      .spyOn(creditBucketRepository, "prepareConsumption")
      .mockResolvedValue(consumptions);
    const { tx, create } = openTransaction();

    const spent = await spend({ scope, tx, payer, quotedCents: 100n });

    expect(spent).toEqual({
      transactionId: "debit-1",
      quotedCents: 100n,
      chargedCents: 100n,
      shortfall: false,
    });
    expect(prepare).toHaveBeenCalledExactlyOnceWith(
      "mainnet",
      null,
      "org-1",
      100n,
      tx,
      { projectId: "project-1" },
    );
    // The buckets and their order are the repository's, written as chosen.
    expect(create).toHaveBeenCalledExactlyOnceWith({
      data: {
        amount: -100n,
        userId: null,
        organizationId: "org-1",
        creditConsumptions: { createMany: { data: consumptions } },
      },
      select: { id: true },
    });
  });

  it("writes nothing and reports the shortfall when the credits do not cover the price", async () => {
    vi.spyOn(creditBucketRepository, "prepareConsumption").mockRejectedValue(
      new InsufficientBalanceError(100n, 75n),
    );
    const { tx, create } = openTransaction();

    const spent = await spend({ scope, tx, payer, quotedCents: 100n });

    expect(spent).toEqual({
      transactionId: null,
      quotedCents: 100n,
      chargedCents: 0n,
      shortfall: true,
      availableCents: 75n,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("lets any other failure of the bucket read through", async () => {
    vi.spyOn(creditBucketRepository, "prepareConsumption").mockRejectedValue(
      new Error("Cents to consume must be positive"),
    );
    const { tx, create } = openTransaction();

    await expect(spend({ scope, tx, payer, quotedCents: 0n })).rejects.toThrow(
      "Cents to consume must be positive",
    );
    expect(create).not.toHaveBeenCalled();
  });
});
