import {
  creditBucketRepository,
  InsufficientBalanceError,
} from "@sokosumi/database/repositories";
import { describe, expect, it, vi } from "vitest";

import type { NetworkDb, NetworkScope, SharedDb } from "@/lib/db/network-scope";

import { spend } from "./spend";

const scope = { network: "mainnet" } as NetworkScope;
const tx = {} as SharedDb;
const payer = { userId: null, organizationId: "org-1", projectId: "project-1" };

describe("spend", () => {
  it("writes the debit on the caller's transaction and returns it as charged in full", async () => {
    const consumptions = [
      { bucketId: "bucket-project", amount: 40n },
      { bucketId: "bucket-pool", amount: 60n },
    ];
    const prepare = vi
      .spyOn(creditBucketRepository, "prepareConsumption")
      .mockResolvedValue(consumptions);
    const record = vi
      .spyOn(creditBucketRepository, "recordSpend")
      .mockResolvedValue("debit-1");

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
    expect(record).toHaveBeenCalledExactlyOnceWith(
      "mainnet",
      { userId: null, organizationId: "org-1", cents: 100n, consumptions },
      tx,
    );
    // The same transaction, not one that only looks like it.
    expect(prepare.mock.calls[0]?.[4]).toBe(tx);
    expect(record.mock.calls[0]?.[2]).toBe(tx);
  });

  it("writes nothing and reports the shortfall when the credits do not cover the price", async () => {
    vi.spyOn(creditBucketRepository, "prepareConsumption").mockRejectedValue(
      new InsufficientBalanceError(100n, 75n),
    );
    const record = vi.spyOn(creditBucketRepository, "recordSpend");

    const spent = await spend({ scope, tx, payer, quotedCents: 100n });

    expect(spent).toEqual({
      transactionId: null,
      quotedCents: 100n,
      chargedCents: 0n,
      shortfall: true,
      availableCents: 75n,
    });
    expect(record).not.toHaveBeenCalled();
  });

  it("lets any other failure of the bucket read through", async () => {
    vi.spyOn(creditBucketRepository, "prepareConsumption").mockRejectedValue(
      new Error("Cents to consume must be positive"),
    );
    const record = vi.spyOn(creditBucketRepository, "recordSpend");

    await expect(spend({ scope, tx, payer, quotedCents: 0n })).rejects.toThrow(
      "Cents to consume must be positive",
    );
    expect(record).not.toHaveBeenCalled();
  });
});

/**
 * Never called: `tsc` checks it. Each `@ts-expect-error` is a use that must
 * not compile, so loosening a type fails the typecheck here.
 */
export function _wrongSpendsDoNotCompile(
  networkTx: NetworkDb,
  sharedTx: SharedDb,
): void {
  void spend({ scope, tx: sharedTx, payer, quotedCents: 1n });

  // @ts-expect-error the debit rides on the shared side's transaction, never on a Network's
  void spend({ scope, tx: networkTx, payer, quotedCents: 1n });
  // @ts-expect-error the Network comes from a scope, not from its name
  void spend({ scope: "preprod", tx: sharedTx, payer, quotedCents: 1n });
}
