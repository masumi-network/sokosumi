import {
  creditBucketRepository,
  InsufficientBalanceError,
} from "@sokosumi/database/repositories";
import { describe, expect, it, vi } from "vitest";

import { badRequest, forbidden, unprocessableEntity } from "@/helpers/error";
import type { NetworkDb, NetworkScope, SharedDb } from "@/lib/db/network-scope";
import { retriedTransactionOn } from "@/lib/db/transaction";

import {
  type SpendCharged,
  type SpendInput,
  type SpendNotCharged,
  type SpendResult,
  spend,
  spendFailedInPreparation,
} from "./spend";

const scope = { network: "mainnet" } as NetworkScope;
const tx = {} as SharedDb;
const payer = { userId: null, organizationId: "org-1", projectId: "project-1" };
const consumptions = [
  { bucketId: "bucket-project", amount: 40n },
  { bucketId: "bucket-pool", amount: 60n },
];

function repository() {
  return {
    balance: vi.spyOn(creditBucketRepository, "getNetworkBalance"),
    prepare: vi
      .spyOn(creditBucketRepository, "prepareConsumption")
      .mockResolvedValue(consumptions),
    record: vi
      .spyOn(creditBucketRepository, "recordSpend")
      .mockResolvedValue("debit-1"),
  };
}

describe("spend in full", () => {
  it("writes the debit on the caller's transaction and returns it as charged in full", async () => {
    const { balance, prepare, record } = repository();

    const spent = await spend({
      scope,
      tx,
      kind: "competitor_check",
      payer,
      quotedCents: 100n,
      mode: "in_full",
    });

    expect(spent).toEqual({
      outcome: "charged",
      transactionId: "debit-1",
      createdAt: expect.any(Date),
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
      {
        userId: null,
        organizationId: "org-1",
        cents: 100n,
        consumptions,
        createdAt: expect.any(Date),
      },
      tx,
    );
    // The debit's time is the one returned, for the caller's receipt.
    expect(spent.createdAt).toBe(record.mock.calls[0]?.[1].createdAt);
    // The same transaction, not one that only looks like it.
    expect(prepare.mock.calls[0]?.[4]).toBe(tx);
    expect(record.mock.calls[0]?.[2]).toBe(tx);
    // The caller keeps its own balance read: this mode adds none.
    expect(balance).not.toHaveBeenCalled();
  });

  it("writes nothing and reports the shortfall when the credits do not cover the price", async () => {
    const { prepare, record } = repository();
    prepare.mockRejectedValue(new InsufficientBalanceError(100n, 75n));

    const spent = await spend({
      scope,
      tx,
      kind: "competitor_check",
      payer,
      quotedCents: 100n,
      mode: "in_full",
    });

    expect(spent).toEqual({
      outcome: "not_charged",
      transactionId: null,
      createdAt: null,
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
      tx,
      kind: "competitor_check",
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
      tx,
      kind: "competitor_check",
      payer,
      quotedCents: 0n,
      mode: "in_full_or_zero",
    });

    expect(spent).toEqual({
      outcome: "recorded_zero",
      transactionId: "debit-1",
      createdAt: expect.any(Date),
      quotedCents: 0n,
      chargedCents: 0n,
      shortfall: false,
    });
    expect(record).toHaveBeenCalledExactlyOnceWith(
      "mainnet",
      {
        userId: null,
        organizationId: "org-1",
        cents: 0n,
        consumptions: [],
        createdAt: expect.any(Date),
      },
      tx,
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(balance).not.toHaveBeenCalled();
  });

  it("charges a price above zero in full, or nothing", async () => {
    const { prepare, record } = repository();
    const input = {
      scope,
      tx,
      kind: "competitor_check",
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
    tx,
    kind: "competitor_check",
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
      createdAt: expect.any(Date),
      quotedCents: 120n,
      chargedCents: 90n,
      shortfall: true,
    });
    expect(balance).toHaveBeenCalledExactlyOnceWith(
      "mainnet",
      null,
      "org-1",
      tx,
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
      createdAt: expect.any(Date),
      quotedCents: 120n,
      chargedCents: 120n,
      shortfall: false,
    });
    expect(prepare.mock.calls[0]?.[3]).toBe(120n);
  });

  it("writes nothing for a wallet that is empty when it is read", async () => {
    const { balance, prepare, record } = repository();
    balance.mockResolvedValue(0n);

    expect(await spend(input)).toEqual({
      outcome: "not_charged",
      transactionId: null,
      createdAt: null,
      quotedCents: 120n,
      chargedCents: 0n,
      shortfall: true,
      availableCents: 0n,
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("throws the original error, with the amount it attempted, when a balance it read is gone before the buckets are chosen", async () => {
    const { balance, prepare, record } = repository();
    balance.mockResolvedValue(90n);
    // What `prepareConsumption` throws for the 90 it was asked to cover.
    const late = new InsufficientBalanceError(90n, 0n);
    prepare.mockRejectedValue(late);

    const thrown = await spend(input).catch((error) => error);

    expect(thrown).toBe(late);
    expect(thrown).toMatchObject({
      message: "Insufficient balance: tried to consume 90 but only 0 available",
      requested: 90n,
      available: 0n,
    });
    expect(spendFailedInPreparation(thrown)).toBe(true);
    expect(record).not.toHaveBeenCalled();
  });
});

describe("a spend that fails", () => {
  const input = {
    scope,
    tx,
    kind: "competitor_check",
    payer,
    quotedCents: 120n,
    mode: "up_to_balance",
  } as const;

  it("throws the original error at every stage, and says which stage it was", async () => {
    const failure = new Error("relation does not exist");
    const { balance, prepare, record } = repository();

    balance.mockRejectedValueOnce(failure).mockResolvedValue(500n);
    const duringBalance = await spend(input).catch((error) => error);
    const balanceStage = spendFailedInPreparation(duringBalance);
    prepare.mockRejectedValueOnce(failure);
    const duringBuckets = await spend(input).catch((error) => error);
    const bucketStage = spendFailedInPreparation(duringBuckets);
    expect(record).not.toHaveBeenCalled();
    record.mockRejectedValueOnce(failure);
    const duringWrite = await spend(input).catch((error) => error);
    const writeStage = spendFailedInPreparation(duringWrite);

    expect([duringBalance, duringBuckets, duringWrite]).toEqual([
      failure,
      failure,
      failure,
    ]);
    expect(duringWrite).toBe(failure);
    expect([balanceStage, bucketStage, writeStage]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("classifies one error object by the call that threw it last", async () => {
    const failure = new Error("connection lost");
    const { prepare, record } = repository();
    const inFull = { ...input, mode: "in_full" } as const;

    prepare.mockRejectedValueOnce(failure);
    await spend(inFull).catch(() => undefined);
    const afterPreparation = spendFailedInPreparation(failure);
    record.mockRejectedValueOnce(failure);
    await spend(inFull).catch(() => undefined);
    const afterWrite = spendFailedInPreparation(failure);
    prepare.mockRejectedValueOnce(failure);
    await spend(inFull).catch(() => undefined);

    expect([
      afterPreparation,
      afterWrite,
      spendFailedInPreparation(failure),
    ]).toEqual([true, false, true]);
  });

  it("does not call missing credits a failed preparation where they are an outcome", async () => {
    const { prepare } = repository();
    const missing = new InsufficientBalanceError(100n, 75n);
    prepare.mockRejectedValue(missing);

    await spend({ ...input, mode: "in_full" });

    expect(spendFailedInPreparation(missing)).toBe(false);
    expect(spendFailedInPreparation("not an error")).toBe(false);
  });

  it("counts a scope that refuses its Network as a failed preparation", async () => {
    const { prepare, record } = repository();
    const refusal = forbidden("Preprod is not enabled for this workspace");
    const refusing = {
      get network(): never {
        throw refusal;
      },
    } as unknown as NetworkScope;

    const thrown = await spend({
      ...input,
      scope: refusing,
      mode: "in_full",
    }).catch((error) => error);

    expect(thrown).toBe(refusal);
    expect(spendFailedInPreparation(thrown)).toBe(true);
    expect(prepare).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});

/** A Preprod scope, which charges no credits (the user, 2026-11-26). */
const preprod = { network: "preprod" } as NetworkScope;
/** `spend` for a mode or kind chosen at run time, as `it.each` hands them. */
const spendAny = spend as (input: SpendInput) => Promise<SpendResult>;

describe("a spend on Preprod", () => {
  const recorded = ["job_hire", "task_credits", "coworker_usage"] as const;
  const modes = ["in_full", "in_full_or_zero", "up_to_balance"] as const;

  it.each(recorded.flatMap((kind) => modes.map((mode) => ({ kind, mode }))))(
    "records $kind's price in $mode mode, and takes no credits",
    async ({ kind, mode }) => {
      const { balance, prepare, record } = repository();

      const spent = await spendAny({
        scope: preprod,
        tx,
        kind,
        payer,
        quotedCents: 100n,
        mode,
      });

      expect(spent).toEqual({
        outcome: "recorded_not_charged",
        transactionId: "debit-1",
        createdAt: expect.any(Date),
        quotedCents: 100n,
        chargedCents: 0n,
        shortfall: false,
      });
      // The price, on Preprod's own tables, with no consumption.
      expect(record).toHaveBeenCalledExactlyOnceWith(
        "preprod",
        {
          userId: null,
          organizationId: "org-1",
          cents: 100n,
          consumptions: [],
          createdAt: expect.any(Date),
        },
        tx,
      );
      expect(spent.createdAt).toBe(record.mock.calls[0]?.[1].createdAt);
      // No balance and no bucket choice, whose reads include the Seat and plan.
      expect(balance).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
    },
  );

  it("records a price of zero as a debit of zero where the mode allows it", async () => {
    const { prepare, record } = repository();

    const spent = await spend({
      scope: preprod,
      tx,
      kind: "coworker_usage",
      payer,
      quotedCents: 0n,
      mode: "in_full_or_zero",
    });

    expect(spent).toMatchObject({ outcome: "recorded_zero", chargedCents: 0n });
    expect(record.mock.calls[0]?.[0]).toBe("preprod");
    expect(prepare).not.toHaveBeenCalled();
  });

  it.each(["in_full", "up_to_balance"] as const)(
    "refuses a price of zero in %s mode, as Mainnet does, before anything is written",
    async (mode) => {
      const { record } = repository();

      const thrown = await spendAny({
        scope: preprod,
        tx,
        kind: "job_hire",
        payer,
        quotedCents: 0n,
        mode,
      }).catch((error) => error);

      expect(thrown).toMatchObject({
        message: "Cents to consume must be positive",
      });
      expect(spendFailedInPreparation(thrown)).toBe(true);
      expect(record).not.toHaveBeenCalled();
    },
  );

  it.each(["seo_chat", "competitor_check", "soko_bot_turn"] as const)(
    "refuses %s, which spends Mainnet credits only, before anything is read or written",
    async (kind) => {
      const { balance, prepare, record } = repository();

      const thrown = await spend({
        scope: preprod,
        tx,
        kind,
        payer,
        quotedCents: 100n,
        mode: "in_full",
      }).catch((error) => error);

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).toMatchObject({
        message: `${kind} spends Mainnet credits only, and was given the preprod scope, which charges no credits`,
      });
      expect(spendFailedInPreparation(thrown)).toBe(true);
      expect(balance).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    },
  );

  it("charges the same kinds on Mainnet as before", async () => {
    const { prepare } = repository();

    const spent = await spend({
      scope,
      tx,
      kind: "job_hire",
      payer,
      quotedCents: 100n,
      mode: "in_full",
    });

    expect(spent).toMatchObject({ outcome: "charged", chargedCents: 100n });
    expect(prepare.mock.calls[0]?.[0]).toBe("mainnet");
  });
});

const CONFLICT_TEXT =
  "Transaction failed due to a write conflict or a deadlock. Please retry your transaction";
/** Prisma's own conflict, as a model read reports it: known by its code. */
const modelConflict = () =>
  Object.assign(new Error(CONFLICT_TEXT), { code: "P2034" });

/** A caller's transaction on the repo's retry helper, counting its attempts. */
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

/**
 * The same transaction conflict, in the preparation and in the write, under
 * the repo's own retry (`retriedTransactionOn`), for the two kinds of caller
 * the payers are: one that answers a failed preparation itself, as the Task
 * writer (422) and Coworker usage (400) do, and one that maps nothing, as the
 * competitor check.
 */
describe("a transaction conflict during a spend", () => {
  const input = {
    scope,
    tx,
    kind: "competitor_check",
    payer,
    quotedCents: 100n,
    mode: "in_full",
  } as const;

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

    prepare.mockRejectedValueOnce(modelConflict());
    const inPreparation = await underRetry(mapsNothing);
    record.mockRejectedValueOnce(modelConflict());
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

    prepare.mockRejectedValueOnce(modelConflict());
    const inPreparation = await underRetry(mapsThePreparation);
    record.mockRejectedValueOnce(modelConflict());
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
 * The plan read stays the model read. With the real repository, a conflict in
 * the Organization's plan read reaches the caller as Prisma's `P2034`, the
 * form `origin/main` answers with Coworker usage's 400 and no retry. A raw
 * SQL plan read would report `40001` instead, which the retry takes.
 */
describe("a conflict in the plan read", () => {
  it("is the model read's conflict, which a Coworker-style caller answers once with its 400", async () => {
    // The real repository, without the spies of the tests above.
    vi.restoreAllMocks();
    const conflict = modelConflict();
    const findContract = vi.fn().mockRejectedValue(conflict);
    const queryRaw = vi.fn();
    const planTx = {
      enterpriseContract: { findFirst: findContract },
      $queryRaw: queryRaw,
    } as unknown as SharedDb;
    const coworkerUsage = () =>
      spend({
        scope,
        tx: planTx,
        kind: "coworker_usage",
        payer: { userId: "user-1", organizationId: "org-1", projectId: null },
        quotedCents: 100n,
        mode: "in_full_or_zero",
      }).catch((error: unknown) => {
        if (spendFailedInPreparation(error) && error instanceof Error) {
          throw badRequest(error.message);
        }
        throw error;
      });

    const answered = await underRetry(coworkerUsage);

    expect(findContract).toHaveBeenCalledOnce();
    expect(spendFailedInPreparation(conflict)).toBe(true);
    expect(answered.attempts).toBe(1);
    expect(answered.error).toMatchObject({
      status: 400,
      message: CONFLICT_TEXT,
    });
    // The plan was read through the model: no raw statement was reached.
    expect(queryRaw).not.toHaveBeenCalled();
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
  const base = {
    scope,
    kind: "competitor_check",
    payer,
    quotedCents: 1n,
    tx: sharedTx,
  } as const;
  const inFull: SpendCharged | SpendNotCharged = await spend({
    ...base,
    mode: "in_full",
  });
  const partly: SpendResult<"up_to_balance"> = await spend({
    ...base,
    mode: "up_to_balance",
  });
  // A debit that was written always has its id.
  if (inFull.outcome === "charged") inFull.transactionId.toUpperCase();
  if (partly.outcome === "partly_charged") partly.transactionId.toUpperCase();

  // @ts-expect-error the debit rides on the shared side's transaction, as every payer opens it today
  void spend({ ...base, tx: networkTx, mode: "in_full" });
  // @ts-expect-error the Network comes from a scope, not from its name
  void spend({ ...base, scope: "preprod", mode: "in_full" });
  // @ts-expect-error a spend says what it does with its price
  void spend({ ...base });
  // @ts-expect-error paying in full never answers with a partial charge
  if (inFull.outcome === "partly_charged") void inFull;
  // @ts-expect-error nor with a recorded zero
  if (inFull.outcome === "recorded_zero") void inFull;
  // @ts-expect-error nothing written has no id to use
  if (inFull.outcome === "not_charged") inFull.transactionId.toUpperCase();
  // @ts-expect-error a Mainnet-only kind is never only recorded
  if (inFull.outcome === "recorded_not_charged") void inFull;
  // @ts-expect-error a spend says what it pays for
  void spend({ scope, payer, quotedCents: 1n, tx: sharedTx, mode: "in_full" });

  // A kind that runs on Preprod may be only recorded, with the id of its debit.
  const hire = await spend({ ...base, kind: "job_hire", mode: "in_full" });
  if (hire.outcome === "recorded_not_charged") hire.transactionId.toUpperCase();
}
