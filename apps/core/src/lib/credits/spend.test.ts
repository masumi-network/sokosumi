import {
  creditBucketRepository,
  InsufficientBalanceError,
} from "@sokosumi/database/repositories";
import { describe, expect, it, vi } from "vitest";

import { unprocessableEntity } from "@/helpers/error";
import type { NetworkDb, NetworkScope, SharedDb } from "@/lib/db/network-scope";
import { retriedTransactionOn } from "@/lib/db/transaction";

import {
  type SpendCharged,
  type SpendNotCharged,
  type SpendResult,
  spend,
  spendFailedInPreparation,
} from "./spend";

const scope = { network: "mainnet" } as NetworkScope;
const shared = {} as SharedDb;
const network = {} as NetworkDb;
const payer = { userId: null, organizationId: "org-1", projectId: "project-1" };
const consumptions = [
  { bucketId: "bucket-project", amount: 40n },
  { bucketId: "bucket-pool", amount: 60n },
];

function repository() {
  return {
    balance: vi.spyOn(creditBucketRepository, "getBalanceOn"),
    prepare: vi
      .spyOn(creditBucketRepository, "prepareConsumptionOn")
      .mockResolvedValue(consumptions),
    record: vi
      .spyOn(creditBucketRepository, "recordSpend")
      .mockResolvedValue("debit-1"),
  };
}

describe("spend in full", () => {
  it("writes the debit on the caller's transaction and returns it as charged in full", async () => {
    const { balance, prepare, record } = repository();
    const tx = { shared };

    const spent = await spend({
      scope,
      tx,
      payer,
      quotedCents: 100n,
      mode: "in_full",
    });

    expect(spent).toEqual({
      outcome: "charged",
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
      shared,
    );
    // The same transaction, not one that only looks like it.
    expect(record.mock.calls[0]?.[2]).toBe(shared);
    // The caller keeps its own balance read: this mode adds none.
    expect(balance).not.toHaveBeenCalled();
  });

  it("reads and writes on a Network-side transaction when the caller opened that side", async () => {
    const { prepare, record } = repository();
    const tx = { network };

    await spend({ scope, tx, payer, quotedCents: 100n, mode: "in_full" });

    expect(prepare.mock.calls[0]?.[4]).toBe(tx);
    expect(record.mock.calls[0]?.[2]).toBe(network);
  });

  it("writes nothing and reports the shortfall when the credits do not cover the price", async () => {
    const { prepare, record } = repository();
    prepare.mockRejectedValue(new InsufficientBalanceError(100n, 75n));

    const spent = await spend({
      scope,
      tx: { shared },
      payer,
      quotedCents: 100n,
      mode: "in_full",
    });

    expect(spent).toEqual({
      outcome: "not_charged",
      transactionId: null,
      quotedCents: 100n,
      chargedCents: 0n,
      shortfall: true,
      availableCents: 75n,
    });
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses a price of zero before anything is written", async () => {
    const { prepare, record } = repository();
    prepare.mockRejectedValue(new Error("Cents to consume must be positive"));

    const thrown = await spend({
      scope,
      tx: { shared },
      payer,
      quotedCents: 0n,
      mode: "in_full",
    }).catch((error) => error);

    expect(thrown).toMatchObject({
      message: "Cents to consume must be positive",
    });
    expect(spendFailedInPreparation(thrown)).toBe(true);
    expect(record).not.toHaveBeenCalled();
  });
});

describe("spend in full or zero", () => {
  it("records a price of zero as a debit of zero, with no bucket read", async () => {
    const { balance, prepare, record } = repository();

    const spent = await spend({
      scope,
      tx: { shared },
      payer,
      quotedCents: 0n,
      mode: "in_full_or_zero",
    });

    expect(spent).toEqual({
      outcome: "recorded_zero",
      transactionId: "debit-1",
      quotedCents: 0n,
      chargedCents: 0n,
      shortfall: false,
    });
    expect(record).toHaveBeenCalledExactlyOnceWith(
      "mainnet",
      { userId: null, organizationId: "org-1", cents: 0n, consumptions: [] },
      shared,
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(balance).not.toHaveBeenCalled();
  });

  it("charges a price above zero in full, or nothing", async () => {
    const { prepare, record } = repository();
    const input = {
      scope,
      tx: { shared },
      payer,
      quotedCents: 100n,
      mode: "in_full_or_zero",
    } as const;

    expect((await spend(input)).outcome).toBe("charged");
    prepare.mockRejectedValue(new InsufficientBalanceError(100n, 75n));
    expect((await spend(input)).outcome).toBe("not_charged");
    expect(record).toHaveBeenCalledOnce();
  });
});

describe("spend up to the balance", () => {
  const input = {
    scope,
    tx: { shared },
    payer,
    quotedCents: 120n,
    mode: "up_to_balance",
  } as const;

  it("charges what the balance holds when that is less than the price", async () => {
    const { balance, prepare, record } = repository();
    balance.mockResolvedValue(90n);

    const spent = await spend(input);

    expect(spent).toEqual({
      outcome: "partly_charged",
      transactionId: "debit-1",
      quotedCents: 120n,
      chargedCents: 90n,
      shortfall: true,
    });
    expect(balance).toHaveBeenCalledExactlyOnceWith(
      "mainnet",
      null,
      "org-1",
      input.tx,
      { projectId: "project-1" },
    );
    expect(prepare.mock.calls[0]?.[3]).toBe(90n);
    expect(record.mock.calls[0]?.[1]).toMatchObject({ cents: 90n });
  });

  it("charges the price in full when the balance covers it", async () => {
    const { balance, prepare } = repository();
    balance.mockResolvedValue(500n);

    expect(await spend(input)).toEqual({
      outcome: "charged",
      transactionId: "debit-1",
      quotedCents: 120n,
      chargedCents: 120n,
      shortfall: false,
    });
    expect(prepare.mock.calls[0]?.[3]).toBe(120n);
  });

  it("writes nothing for an empty balance", async () => {
    const { balance, prepare, record } = repository();
    balance.mockResolvedValue(0n);

    expect(await spend(input)).toEqual({
      outcome: "not_charged",
      transactionId: null,
      quotedCents: 120n,
      chargedCents: 0n,
      shortfall: true,
      availableCents: 0n,
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});

describe("a spend that fails", () => {
  const failure = new Error("relation does not exist");
  const input = {
    scope,
    tx: { shared },
    payer,
    quotedCents: 120n,
    mode: "up_to_balance",
  } as const;

  it("throws the original error at every stage, and says which stage it was", async () => {
    const { balance, prepare, record } = repository();

    balance.mockRejectedValueOnce(failure).mockResolvedValue(500n);
    const duringBalance = await spend(input).catch((error) => error);
    const balanceStage = spendFailedInPreparation(duringBalance);
    prepare.mockRejectedValueOnce(new Error("relation does not exist"));
    const duringBuckets = await spend(input).catch((error) => error);
    expect(record).not.toHaveBeenCalled();
    // The same failure, thrown by the write this time.
    const writeFailure = new Error("relation does not exist");
    record.mockRejectedValueOnce(writeFailure);
    const duringWrite = await spend(input).catch((error) => error);

    expect(duringBalance).toBe(failure);
    expect(duringBuckets).toMatchObject({ message: failure.message });
    expect(duringWrite).toBe(writeFailure);
    expect([
      balanceStage,
      spendFailedInPreparation(duringBuckets),
      spendFailedInPreparation(duringWrite),
    ]).toEqual([true, true, false]);
  });

  it("does not call missing credits a failure of the preparation", async () => {
    const { prepare } = repository();
    const missing = new InsufficientBalanceError(100n, 75n);
    prepare.mockRejectedValue(missing);

    await spend({ ...input, mode: "in_full" });

    expect(spendFailedInPreparation(missing)).toBe(false);
    expect(spendFailedInPreparation("not an error")).toBe(false);
  });
});

/**
 * The same transaction conflict, in the preparation and in the write, under
 * the repo's own retry (`retriedTransactionOn`), for the two kinds of caller
 * the payers are: one that answers a failed preparation itself, as the Task
 * writer (422) and Coworker usage (400) do, and one that maps nothing, as the
 * competitor check.
 */
const CONFLICT_TEXT =
  "Transaction failed due to a write conflict or a deadlock. Please retry your transaction";

describe("a transaction conflict during a spend", () => {
  const conflict = () =>
    // Prisma's own conflict, known by its code. Its text names no SQLSTATE,
    // so a 422 that repeats the text is not taken for a conflict again.
    Object.assign(new Error(CONFLICT_TEXT), { code: "P2034" });
  const input = {
    scope,
    tx: { shared },
    payer,
    quotedCents: 100n,
    mode: "in_full",
  } as const;

  /** A caller's transaction on the retry helper, counting its attempts. */
  async function underRetry(charge: () => Promise<unknown>) {
    let attempts = 0;
    const client = {
      $transaction: async (callback: (tx: never) => Promise<unknown>) => {
        attempts += 1;
        return await callback(undefined as never);
      },
    } as unknown as Parameters<typeof retriedTransactionOn>[0];
    vi.useFakeTimers();
    const settled = retriedTransactionOn(client, charge, "try again").then(
      (value): { value?: unknown; error?: unknown } => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.runAllTimersAsync();
    return { ...(await settled), attempts };
  }

  const mapsNothing = () => spend(input);
  const mapsThePreparation = () =>
    spend(input).catch((error: unknown) => {
      if (!spendFailedInPreparation(error)) throw error;
      // As the Task writer on `origin/main`: the failure's text, as a 422.
      throw unprocessableEntity(
        error instanceof Error ? error.message : "The charge failed",
      );
    });

  it("is retried, in either stage, for a caller that maps nothing", async () => {
    const { prepare, record } = repository();

    prepare.mockRejectedValueOnce(conflict());
    const inPreparation = await underRetry(mapsNothing);
    record.mockRejectedValueOnce(conflict());
    const inTheWrite = await underRetry(mapsNothing);

    expect(inPreparation).toMatchObject({
      attempts: 2,
      value: { outcome: "charged" },
    });
    expect(inTheWrite).toMatchObject({
      attempts: 2,
      value: { outcome: "charged" },
    });
  });

  it("is the caller's own answer in the preparation, and is retried in the write, for a caller that maps the preparation", async () => {
    const { prepare, record } = repository();

    prepare.mockRejectedValueOnce(conflict());
    const inPreparation = await underRetry(mapsThePreparation);
    record.mockRejectedValueOnce(conflict());
    const inTheWrite = await underRetry(mapsThePreparation);

    // Answered once, as on `origin/main`: no second attempt.
    expect(inPreparation.attempts).toBe(1);
    expect(inPreparation.error).toMatchObject({
      status: 422,
      message: CONFLICT_TEXT,
    });
    expect(inTheWrite).toMatchObject({
      attempts: 2,
      value: { outcome: "charged" },
    });
  });
});

/**
 * Never called: `tsc` checks it. Each `@ts-expect-error` is a use that must
 * not compile, so loosening a type fails the typecheck here.
 */
export async function _wrongSpendsDoNotCompile(
  networkTx: NetworkDb,
  sharedTx: SharedDb,
): Promise<void> {
  const base = { scope, payer, quotedCents: 1n };
  // One operation, from a callback of either side.
  const inFull: SpendCharged | SpendNotCharged = await spend({
    ...base,
    tx: { shared: sharedTx },
    mode: "in_full",
  });
  await spend({ ...base, tx: { network: networkTx }, mode: "in_full" });
  const partly: SpendResult<"up_to_balance"> = await spend({
    ...base,
    tx: { shared: sharedTx },
    mode: "up_to_balance",
  });
  // A debit that was written always has its id.
  if (inFull.outcome === "charged") inFull.transactionId.toUpperCase();
  if (partly.outcome === "partly_charged") partly.transactionId.toUpperCase();

  // @ts-expect-error a Network-side transaction is not the shared side's
  void spend({ ...base, tx: { shared: networkTx }, mode: "in_full" });
  // @ts-expect-error the shared side's transaction is not a Network side's
  void spend({ ...base, tx: { network: sharedTx }, mode: "in_full" });
  // @ts-expect-error a transaction names its side
  void spend({ ...base, tx: sharedTx, mode: "in_full" });
  // @ts-expect-error the Network comes from a scope, not from its name
  void spend({ ...base, scope: "preprod", tx: { shared: sharedTx } });
  // @ts-expect-error a spend says what it does with its price
  void spend({ ...base, tx: { shared: sharedTx } });
  // @ts-expect-error paying in full never answers with a partial charge
  if (inFull.outcome === "partly_charged") void inFull;
  // @ts-expect-error nor with a recorded zero
  if (inFull.outcome === "recorded_zero") void inFull;
  // @ts-expect-error nothing written has no id to use
  if (inFull.outcome === "not_charged") inFull.transactionId.toUpperCase();
}
