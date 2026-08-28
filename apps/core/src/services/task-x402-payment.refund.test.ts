import { CreditBucketReferenceType } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  paymentUpdateManyMock,
  paymentFindUniqueMock,
  paymentUpdateMock,
  actionCreateMock,
  actionCreateManyMock,
} = vi.hoisted(() => ({
  paymentUpdateManyMock: vi.fn(),
  paymentFindUniqueMock: vi.fn(),
  paymentUpdateMock: vi.fn(),
  actionCreateMock: vi.fn(),
  actionCreateManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        taskX402Payment: {
          updateMany: paymentUpdateManyMock,
          findUnique: paymentFindUniqueMock,
          update: paymentUpdateMock,
        },
        taskX402PaymentAction: {
          create: actionCreateMock,
          createMany: actionCreateManyMock,
        },
      }),
  },
}));

import {
  refundRefusedTaskX402Payment,
  refundVerifiedTaskX402Payment,
  resolvePendingTaskX402Payment,
  TASK_X402_FAILURE_REASONS,
} from "./task-x402-payment.refund";
import {
  TASK_X402_MAX_SIGN_RISK_MS,
  TASK_X402_SIGN_LEASE_MS,
} from "./task-x402-payment.replay";

const PAYMENT_ID = "pay_1";
const CHARGE_TRANSACTION_ID = "charge_tx_1";
const REFUND_TRANSACTION_ID = "refund_tx_1";
const USER_ID = "user_1";
const ORGANIZATION_ID = "org_1";
const TASK_ID = "task_1";
const AGENT_ID = "agent_1";
const ASSET = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const CAIP2_NETWORK = "eip155:8453";
const ON_CHAIN_AMOUNT = "1500000";

/**
 * The charge Transaction. `amount` is NEGATIVE by convention
 * (createTaskEventTransaction writes `input.cents * -1n`).
 */
function transaction(overrides: Record<string, unknown> = {}) {
  return { amount: -500n, userId: USER_ID, organizationId: null, ...overrides };
}

/** The payment row as the refund path selects it, money facts included. */
function verifiedPaymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    transactionId: CHARGE_TRANSACTION_ID,
    status: "REFUNDED",
    refundTransactionId: null,
    taskId: TASK_ID,
    agentId: AGENT_ID,
    amount: ON_CHAIN_AMOUNT,
    asset: ASSET,
    caip2Network: CAIP2_NETWORK,
    transaction: transaction(),
    ...overrides,
  };
}

function actionCreateData(): Record<string, unknown> {
  const call = (actionCreateMock.mock.calls[0]?.[0] ??
    actionCreateManyMock.mock.calls[0]?.[0]) as {
    data: Record<string, unknown> | Record<string, unknown>[];
  };
  return Array.isArray(call.data) ? call.data[0] : call.data;
}

/**
 * The `refundKind` written by the update that mints the compensating refund.
 * Read from the same call as the refund itself, because that co-location is
 * the property under test: the label cannot drift from the money.
 */
function refundKindWritten(): unknown {
  const call = paymentUpdateMock.mock.calls[0]?.[0] as {
    data: Record<string, unknown>;
  };
  return call.data.refundKind;
}

/**
 * Installs one mutable in-memory row behind the Prisma mocks: `updateMany`
 * applies its `data` only when the row satisfies the `where`, `findUnique`
 * reads the row back as it now stands, and `update` attaches the refund the
 * way `attachCompensatingRefund` does.
 *
 * Shared by both operator levers, because a `mockResolvedValue({ count })` stub
 * makes the claim's `where` inert — every predicate in it could be deleted
 * without a single assertion noticing.
 */
function installRow(overrides: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id: PAYMENT_ID,
    transactionId: CHARGE_TRANSACTION_ID,
    status: "PENDING",
    processingAt: new Date(Date.now() - TASK_X402_MAX_SIGN_RISK_MS - 1_000),
    signRiskExpiresAt: null,
    signAttemptCount: 1,
    refundTransactionId: null,
    taskId: TASK_ID,
    agentId: AGENT_ID,
    amount: ON_CHAIN_AMOUNT,
    asset: ASSET,
    caip2Network: CAIP2_NETWORK,
    transaction: transaction(),
    ...overrides,
  };
  paymentUpdateManyMock.mockImplementation(
    async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      if (!rowMatchesWhere(row, where)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  );
  paymentFindUniqueMock.mockImplementation(async () => ({ ...row }));
  paymentUpdateMock.mockImplementation(async () => {
    row.refundTransactionId = REFUND_TRANSACTION_ID;
    return { refundTransactionId: REFUND_TRANSACTION_ID };
  });
  return row;
}

describe("refundRefusedTaskX402Payment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paymentUpdateMock.mockResolvedValue({
      refundTransactionId: REFUND_TRANSACTION_ID,
    });
  });

  it("claims PENDING → FAILED, refunds once, and writes a durable failure outcome", async () => {
    paymentUpdateManyMock.mockResolvedValue({ count: 1 });
    paymentFindUniqueMock.mockResolvedValue(
      verifiedPaymentRow({
        status: "FAILED",
        signAttemptCount: 1,
      }),
    );

    const result = await refundRefusedTaskX402Payment(
      PAYMENT_ID,
      TASK_X402_FAILURE_REASONS.NODE_REFUSED_OPERATIONAL,
    );

    expect(result).toBe(true);
    expect(paymentUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: PAYMENT_ID,
        status: "PENDING",
        refundTransactionId: null,
        signAttemptCount: 1,
      },
      data: {
        status: "FAILED",
        failureReason: "node_refused_operational",
      },
    });
    expect(paymentUpdateMock).toHaveBeenCalledTimes(1);
    const updateArg = paymentUpdateMock.mock.calls[0]?.[0] as {
      data: {
        refundTransaction: {
          create: {
            amount: bigint;
            organization?: { connect: { id: string } };
            user: { connect: { id: string } };
            sourceCreditBucket: {
              create: {
                amount: bigint;
                expiresAt: Date | null;
                organizationId?: string | null;
                referenceId: string;
                referenceType: CreditBucketReferenceType;
                user?: { connect: { id: string } };
                userId?: string | null;
              };
            };
          };
        };
      };
    };
    expect(updateArg.data.refundTransaction.create.amount).toBe(500n);
    expect(updateArg.data.refundTransaction.create.user.connect.id).toBe(
      USER_ID,
    );
    const bucket =
      updateArg.data.refundTransaction.create.sourceCreditBucket.create;
    expect(bucket.referenceId).toBe(`task-x402-payment:${PAYMENT_ID}`);
    expect(bucket.referenceType).toBe(CreditBucketReferenceType.REFUND);
    expect(bucket.expiresAt).toBeNull();
    expect(bucket.userId).toBe(USER_ID);
    expect(bucket.organizationId).toBeNull();
    expect(bucket.user).toBeUndefined();
    // Labelled at the mint, in the same update: an automated node-refusal
    // refund is never an operator quality signal.
    expect(refundKindWritten()).toBe("NODE_REFUSAL");
    expect(actionCreateData()).toEqual({
      paymentId: PAYMENT_ID,
      action: "failure",
      operatorId: "system:x402",
      reason: "node_refused_operational",
      cents: 500n,
      amount: ON_CHAIN_AMOUNT,
      asset: ASSET,
      caip2Network: CAIP2_NETWORK,
      taskId: TASK_ID,
      agentId: AGENT_ID,
      chargedUserId: USER_ID,
      chargedOrganizationId: null,
      chargeTransactionId: CHARGE_TRANSACTION_ID,
      refundTransactionId: REFUND_TRANSACTION_ID,
    });
    expect(actionCreateManyMock).toHaveBeenCalledWith({
      data: [expect.objectContaining({ action: "failure" })],
      skipDuplicates: true,
    });
    expect(actionCreateMock).not.toHaveBeenCalled();
  });

  it.each(["FAILED", "REFUNDED"] as const)(
    "is a no-op for an already-compensated %s record (count 0 + refundTransactionId set): returns false, creates no second refund",
    async (status) => {
      // The double-refund guard: the status flip claimed nothing (someone
      // already finalized it) AND a refund transaction already exists — the
      // debit was already restored, so a second refund would double-credit.
      paymentUpdateManyMock.mockResolvedValue({ count: 0 });
      paymentFindUniqueMock.mockResolvedValue({
        id: PAYMENT_ID,
        status,
        refundTransactionId: "refund_existing",
        transaction: transaction(),
      });

      const result = await refundRefusedTaskX402Payment(
        PAYMENT_ID,
        TASK_X402_FAILURE_REASONS.NODE_REFUSED_OPERATIONAL,
      );

      expect(result).toBe(false);
      expect(paymentUpdateMock).not.toHaveBeenCalled();
      expect(actionCreateMock).not.toHaveBeenCalled();
    },
  );

  it("throws rather than minting a second refund on a record that already carries one", async () => {
    // The same claim predicate as both operator levers, for the same reason:
    // `attachCompensatingRefund`'s nested create re-points an occupied optional
    // one-to-one instead of failing, so without `refundTransactionId: null` in
    // the where this anomalous row gets a second refund transaction and a
    // second non-expiring REFUND bucket, and the first is orphaned. Throwing
    // holds the row and pages ops, which is the right answer for a state app
    // code cannot reach.
    const row = installRow({ refundTransactionId: "refund_existing" });

    await expect(
      refundRefusedTaskX402Payment(
        PAYMENT_ID,
        TASK_X402_FAILURE_REASONS.NODE_REFUSED_OPERATIONAL,
      ),
    ).rejects.toThrow(/already carries a compensating refund/);
    expect(row.status).toBe("PENDING");
    expect(paymentUpdateMock).not.toHaveBeenCalled();
  });

  it("throws for a VERIFIED record instead of refunding a live header", async () => {
    // A VERIFIED row carries a signed X-PAYMENT header that could still settle;
    // refunding it would hand back credits for a payment that may go through.
    paymentUpdateManyMock.mockResolvedValue({ count: 0 });
    paymentFindUniqueMock.mockResolvedValue({
      id: PAYMENT_ID,
      status: "VERIFIED",
      refundTransactionId: null,
      transaction: transaction(),
    });

    await expect(
      refundRefusedTaskX402Payment(
        PAYMENT_ID,
        TASK_X402_FAILURE_REASONS.NODE_REFUSED_OPERATIONAL,
      ),
    ).rejects.toThrow(/already verified/);
    expect(paymentUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses to refund a replay refusal after an earlier ambiguous sign attempt", async () => {
    const row = installRow({ signAttemptCount: 2 });

    await expect(
      refundRefusedTaskX402Payment(
        PAYMENT_ID,
        TASK_X402_FAILURE_REASONS.NODE_REFUSED_OPERATIONAL,
      ),
    ).rejects.toThrow(/earlier ambiguous sign attempt/);

    expect(row.status).toBe("PENDING");
    expect(row.refundTransactionId).toBeNull();
    expect(paymentUpdateMock).not.toHaveBeenCalled();
  });
});

describe("refundVerifiedTaskX402Payment", () => {
  const OPERATOR_ID = "operator_1";

  beforeEach(() => {
    vi.clearAllMocks();
    paymentUpdateMock.mockResolvedValue({
      refundTransactionId: REFUND_TRANSACTION_ID,
    });
    actionCreateMock.mockResolvedValue({});
  });

  it("claims VERIFIED → REFUNDED, mints the refund, writes the audit row, returns refunded", async () => {
    paymentUpdateManyMock.mockResolvedValue({ count: 1 });
    paymentFindUniqueMock.mockResolvedValue(
      verifiedPaymentRow({
        transaction: transaction({ organizationId: ORGANIZATION_ID }),
      }),
    );

    const result = await refundVerifiedTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "agent_output_quality",
    });

    expect(result).toMatchObject({ status: "refunded", compensated: true });
    // The goodwill lever ONLY claims a VERIFIED row (the "paid but bad result"
    // case) that has not already been compensated — never a live-header-safe
    // automated status, never a row already carrying a refund.
    expect(paymentUpdateManyMock).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID, status: "VERIFIED", refundTransactionId: null },
      data: { status: "REFUNDED" },
    });
    expect(paymentUpdateMock).toHaveBeenCalledTimes(1);
    const updateArg = paymentUpdateMock.mock.calls[0]?.[0] as {
      data: {
        refundTransaction: {
          create: {
            amount: bigint;
            organization?: { connect: { id: string } };
            user: { connect: { id: string } };
            sourceCreditBucket: {
              create: {
                organizationId?: string | null;
                user?: { connect: { id: string } };
                userId?: string | null;
              };
            };
          };
        };
      };
    };
    expect(updateArg.data.refundTransaction.create.amount).toBe(500n);
    expect(updateArg.data.refundTransaction.create.user.connect.id).toBe(
      USER_ID,
    );
    expect(
      updateArg.data.refundTransaction.create.organization?.connect.id,
    ).toBe(ORGANIZATION_ID);
    expect(
      updateArg.data.refundTransaction.create.sourceCreditBucket.create.userId,
    ).toBeNull();
    expect(
      updateArg.data.refundTransaction.create.sourceCreditBucket.create.user,
    ).toBeUndefined();
    expect(
      updateArg.data.refundTransaction.create.sourceCreditBucket.create
        .organizationId,
    ).toBe(ORGANIZATION_ID);
    // The row records WHICH lever refunded it. The aggregate's headline quality
    // signal counts this kind, so a resolve-produced REFUNDED row must never be
    // mistaken for one of these.
    expect(refundKindWritten()).toBe("OPERATOR_GOODWILL");
    // The audit row is FK-free and outlives the hard-deleted payment, so it
    // must carry every money fact itself. Assert the whole `data` payload, not
    // that the mock was merely called: a row missing one of these is exactly
    // the dangling pointer the denormalized columns exist to prevent.
    expect(actionCreateMock).toHaveBeenCalledTimes(1);
    expect(actionCreateData()).toEqual({
      paymentId: PAYMENT_ID,
      action: "refund",
      operatorId: OPERATOR_ID,
      reason: "agent_output_quality",
      // Debit transaction amount is -500n; the audit row stores the MAGNITUDE.
      cents: 500n,
      amount: ON_CHAIN_AMOUNT,
      asset: ASSET,
      caip2Network: CAIP2_NETWORK,
      taskId: TASK_ID,
      agentId: AGENT_ID,
      chargedUserId: USER_ID,
      chargedOrganizationId: ORGANIZATION_ID,
      chargeTransactionId: CHARGE_TRANSACTION_ID,
      refundTransactionId: REFUND_TRANSACTION_ID,
    });
  });

  it("writes no audit row when a sign-anomalous debit is refused before any money moves", async () => {
    // Why `cents` is written as a magnitude rather than a bare negation is not
    // observable here: attachCompensatingRefund rejects a non-negative debit
    // first, so a sign-anomalous row never reaches the action write on this
    // path. Pin that ordering — an append-only audit row claiming an operator
    // moved money must not survive a refund that threw.
    paymentUpdateManyMock.mockResolvedValue({ count: 1 });
    paymentFindUniqueMock.mockResolvedValue(
      verifiedPaymentRow({ transaction: transaction({ amount: 500n }) }),
    );

    await expect(
      refundVerifiedTaskX402Payment({
        paymentId: PAYMENT_ID,
        operatorId: OPERATOR_ID,
        reason: "agent_output_quality",
      }),
    ).rejects.toThrow(/no debit to refund/);
    expect(actionCreateMock).not.toHaveBeenCalled();
  });

  it.each(["FAILED", "REFUNDED"] as const)(
    "is idempotent for an already-compensated %s record: already_refunded, no second refund, no audit row",
    async (status) => {
      paymentUpdateManyMock.mockResolvedValue({ count: 0 });
      paymentFindUniqueMock.mockResolvedValue({
        id: PAYMENT_ID,
        status,
        refundTransactionId: "refund_existing",
        transaction: transaction(),
      });

      const result = await refundVerifiedTaskX402Payment({
        paymentId: PAYMENT_ID,
        operatorId: OPERATOR_ID,
        reason: "duplicate_charge",
      });

      expect(result).toEqual({ status: "already_refunded" });
      expect(paymentUpdateMock).not.toHaveBeenCalled();
      expect(actionCreateMock).not.toHaveBeenCalled();
    },
  );

  it("refuses a VERIFIED record that already carries a refund", async () => {
    // The claim predicates on `refundTransactionId: null`, not on status alone.
    // Without that, this anomalous row is claimed and the nested create inside
    // attachCompensatingRefund does NOT fail: Prisma re-points the optional
    // one-to-one FK, so a SECOND refund transaction and a SECOND non-expiring
    // REFUND bucket are minted, the first is orphaned, and a complete audit row
    // is written asserting the operator moved money once.
    const row = installRow({
      status: "VERIFIED",
      refundTransactionId: "refund_existing",
    });

    const result = await refundVerifiedTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "agent_output_quality",
    });

    expect(result).toMatchObject({ status: "not_refundable" });
    expect((result as { reason: string }).reason).toMatch(
      /already carries a compensating refund/i,
    );
    expect(row.status).toBe("VERIFIED");
    expect(row.refundTransactionId).toBe("refund_existing");
    expect(paymentUpdateMock).not.toHaveBeenCalled();
    expect(actionCreateMock).not.toHaveBeenCalled();
  });

  it("does NOT call a terminal record with no refund already compensated", async () => {
    // The `already_refunded` guard is (terminal status AND a refund exists).
    // Drop the second conjunct and this row — REFUNDED but never actually
    // compensated — is reported to the operator as already refunded, closing
    // the ticket while the user's credits are still gone. It must fall through
    // to the honest "cannot be refunded in status REFUNDED" instead.
    installRow({ status: "REFUNDED", refundTransactionId: null });

    const result = await refundVerifiedTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "support_adjustment",
    });

    expect(result).not.toEqual({ status: "already_refunded" });
    expect(result).toEqual({
      status: "not_refundable",
      reason: "Payment cannot be refunded in status REFUNDED",
    });
    expect(paymentUpdateMock).not.toHaveBeenCalled();
    expect(actionCreateMock).not.toHaveBeenCalled();
  });

  it("blocks a PENDING record and directs to replay/reconciler", async () => {
    paymentUpdateManyMock.mockResolvedValue({ count: 0 });
    paymentFindUniqueMock.mockResolvedValue({
      id: PAYMENT_ID,
      status: "PENDING",
      refundTransactionId: null,
      transaction: transaction(),
    });

    const result = await refundVerifiedTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "support_adjustment",
    });

    expect(result).toMatchObject({ status: "not_refundable" });
    expect(paymentUpdateMock).not.toHaveBeenCalled();
    expect(actionCreateMock).not.toHaveBeenCalled();
  });

  it("returns not_found for a missing record", async () => {
    paymentUpdateManyMock.mockResolvedValue({ count: 0 });
    paymentFindUniqueMock.mockResolvedValue(null);

    const result = await refundVerifiedTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "support_adjustment",
    });

    expect(result).toEqual({ status: "not_found" });
    expect(paymentUpdateMock).not.toHaveBeenCalled();
    expect(actionCreateMock).not.toHaveBeenCalled();
  });
});

/**
 * A stand-in for the database's OWN predicate evaluation, covering only the
 * shapes the claim uses: scalar equality, `null` equality, `lte` on a Date,
 * and `AND` / `OR`.
 *
 * It exists so the resolve tests below assert BEHAVIOUR instead of the shape
 * of a mock call. With a `mockResolvedValue({ count: n })` stub, the claim's
 * `where` is inert — deleting `status: PENDING` from it changes nothing any
 * assertion can see, and the guard that stops an operator refunding a live
 * VERIFIED header would be untested. Here the fake row only accepts an update
 * it actually matches, so a weakened predicate turns "not_resolvable, no money
 * moved" into "resolved, refund minted" and the test fails.
 */
function rowMatchesWhere(
  row: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "AND") {
      return (condition as Record<string, unknown>[]).every((branch) =>
        rowMatchesWhere(row, branch),
      );
    }
    if (key === "OR") {
      return (condition as Record<string, unknown>[]).some((branch) =>
        rowMatchesWhere(row, branch),
      );
    }
    const value = row[key];
    if (
      condition !== null &&
      typeof condition === "object" &&
      !(condition instanceof Date)
    ) {
      const { lte } = condition as { lte?: Date };
      if (lte === undefined) {
        throw new Error(
          `Unsupported filter on ${key}: ${JSON.stringify(condition)}`,
        );
      }
      return value instanceof Date && value.getTime() <= lte.getTime();
    }
    return value === condition;
  });
}

describe("resolvePendingTaskX402Payment", () => {
  const OPERATOR_ID = "operator_1";

  beforeEach(() => {
    vi.clearAllMocks();
    actionCreateMock.mockResolvedValue({});
  });

  it("claims PENDING → REFUNDED, mints the refund, and writes a complete resolve audit row", async () => {
    const row = installRow({
      transaction: transaction({ organizationId: ORGANIZATION_ID }),
    });

    const result = await resolvePendingTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "unsettleable_authorization",
    });

    expect(result).toMatchObject({
      status: "resolved",
      paymentId: PAYMENT_ID,
      compensated: true,
    });
    // The row really moved — not just "a mock was called".
    expect(row.status).toBe("REFUNDED");
    expect(row.refundTransactionId).toBe(REFUND_TRANSACTION_ID);
    // The compensating refund is the full debit, non-expiring, same shape as
    // every other x402 refund.
    const updateArg = paymentUpdateMock.mock.calls[0]?.[0] as {
      data: {
        refundTransaction: {
          create: {
            amount: bigint;
            organization?: { connect: { id: string } };
            user: { connect: { id: string } };
            sourceCreditBucket: {
              create: {
                amount: bigint;
                expiresAt: Date | null;
                organizationId?: string | null;
                referenceId: string;
                referenceType: CreditBucketReferenceType;
                user?: { connect: { id: string } };
                userId?: string | null;
              };
            };
          };
        };
      };
    };
    expect(updateArg.data.refundTransaction.create.amount).toBe(500n);
    expect(updateArg.data.refundTransaction.create.user.connect.id).toBe(
      USER_ID,
    );
    expect(
      updateArg.data.refundTransaction.create.organization?.connect.id,
    ).toBe(ORGANIZATION_ID);
    const bucket =
      updateArg.data.refundTransaction.create.sourceCreditBucket.create;
    expect(bucket.referenceId).toBe(`task-x402-payment:${PAYMENT_ID}`);
    expect(bucket.referenceType).toBe(CreditBucketReferenceType.REFUND);
    expect(bucket.expiresAt).toBeNull();
    expect(bucket.userId).toBeNull();
    expect(bucket.user).toBeUndefined();
    expect(bucket.organizationId).toBe(ORGANIZATION_ID);
    // A resolve is NOT a goodwill refund: it clears a wedged PENDING charge and
    // says nothing about the agent's output quality. Labelling it at the mint is
    // what keeps it out of the aggregate's headline signal and its ranking.
    expect(refundKindWritten()).toBe("OPERATOR_RESOLVE");
    // The audit row is FK-free and outlives the hard-deleted payment, so every
    // money fact must be on it. `cents` is the MAGNITUDE of a debit stored as
    // -500n. Asserted as a whole object: a missing column is the dangling
    // pointer the NOT NULL constraints exist to prevent.
    expect(actionCreateMock).toHaveBeenCalledTimes(1);
    expect(actionCreateData()).toEqual({
      paymentId: PAYMENT_ID,
      action: "resolve",
      operatorId: OPERATOR_ID,
      reason: "unsettleable_authorization",
      cents: 500n,
      amount: ON_CHAIN_AMOUNT,
      asset: ASSET,
      caip2Network: CAIP2_NETWORK,
      taskId: TASK_ID,
      agentId: AGENT_ID,
      chargedUserId: USER_ID,
      chargedOrganizationId: ORGANIZATION_ID,
      chargeTransactionId: CHARGE_TRANSACTION_ID,
      refundTransactionId: REFUND_TRANSACTION_ID,
    });
  });

  it("is idempotent: a second call on the row it just resolved mints no second refund", async () => {
    installRow();

    const first = await resolvePendingTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "unsettleable_authorization",
    });
    const second = await resolvePendingTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "unsettleable_authorization",
    });

    expect(first).toMatchObject({ status: "resolved" });
    expect(second).toEqual({ status: "already_resolved" });
    // Exactly one refund and one audit row across both calls.
    expect(paymentUpdateMock).toHaveBeenCalledTimes(1);
    expect(actionCreateMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a VERIFIED record: its live header may still settle", async () => {
    // The whole point of scoping resolve to PENDING. If the claim stopped
    // predicating on status, this row would be claimed and a refund minted
    // against an authorization the coworker is holding.
    const row = installRow({ status: "VERIFIED" });

    const result = await resolvePendingTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "unsettleable_authorization",
    });

    expect(result).toMatchObject({ status: "not_resolvable" });
    expect((result as { reason: string }).reason).toMatch(/goodwill refund/i);
    expect(row.status).toBe("VERIFIED");
    expect(row.refundTransactionId).toBeNull();
    expect(paymentUpdateMock).not.toHaveBeenCalled();
    expect(actionCreateMock).not.toHaveBeenCalled();
  });

  it("refuses a PENDING record whose sign lease is still held, and says when to retry", async () => {
    // A leased row is not stuck: a node round-trip is in flight and will
    // settle it within the lease. Resolving underneath it manufactures the
    // signed-after-close state (a live authorization Soko signs and discards)
    // and pages ops for an operator's own action.
    const heldAt = new Date(Date.now() - 5_000);
    const row = installRow({ processingAt: heldAt });

    const result = await resolvePendingTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "sign_attempts_exhausted",
    });

    expect(result).toMatchObject({ status: "sign_in_flight" });
    const leaseResult = result as {
      reason: string;
      retryAfterSeconds: number;
      retryAfter: string;
    };
    // The operator is told WHEN, not just "no".
    expect(leaseResult.retryAfterSeconds).toBe(
      Math.ceil((TASK_X402_SIGN_LEASE_MS - 5_000) / 1_000),
    );
    expect(leaseResult.retryAfter).toBe(
      new Date(heldAt.getTime() + TASK_X402_SIGN_LEASE_MS).toISOString(),
    );
    expect(leaseResult.reason).toContain(leaseResult.retryAfter);
    expect(row.status).toBe("PENDING");
    expect(paymentUpdateMock).not.toHaveBeenCalled();
    expect(actionCreateMock).not.toHaveBeenCalled();
  });

  it("does not resolve after only the short lease expires when the rolling-deploy fence is missing", async () => {
    // An old Core writer can update processingAt without writing the new
    // signRiskExpiresAt column. The lease expiring proves only that the request
    // stopped, not that an authorization from it is dead.
    const row = installRow({
      processingAt: new Date(Date.now() - TASK_X402_SIGN_LEASE_MS - 1_000),
      signRiskExpiresAt: null,
    });

    const result = await resolvePendingTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "sign_attempts_exhausted",
    });

    expect(result).toMatchObject({ status: "sign_outcome_unresolved" });
    expect(row.status).toBe("PENDING");
    expect(paymentUpdateMock).not.toHaveBeenCalled();
    expect(actionCreateMock).not.toHaveBeenCalled();
  });

  it("refuses an expired lease while its unseen authorization may remain live", async () => {
    const signRiskExpiresAt = new Date(
      Date.now() + TASK_X402_MAX_SIGN_RISK_MS + 120_000,
    );
    const row = installRow({
      processingAt: new Date(Date.now() - TASK_X402_SIGN_LEASE_MS - 1_000),
      signRiskExpiresAt,
    });

    const result = await resolvePendingTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "node_unreachable",
    });

    expect(result).toMatchObject({
      status: "sign_outcome_unresolved",
      retryAfter: signRiskExpiresAt.toISOString(),
    });
    expect((result as { reason: string }).reason).toContain(
      signRiskExpiresAt.toISOString(),
    );
    expect(row.status).toBe("PENDING");
    expect(paymentUpdateMock).not.toHaveBeenCalled();
    expect(actionCreateMock).not.toHaveBeenCalled();
  });

  it("resolves after both lease and authorization-risk windows expire", async () => {
    const row = installRow({
      processingAt: new Date(Date.now() - TASK_X402_MAX_SIGN_RISK_MS - 1_000),
      signRiskExpiresAt: new Date(Date.now() - 1_000),
    });

    const result = await resolvePendingTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "node_unreachable",
    });

    expect(result).toMatchObject({ status: "resolved" });
    expect(row.status).toBe("REFUNDED");
  });

  it("does not resolve when an old writer left a stale expired fence beside recent processing", async () => {
    const row = installRow({
      processingAt: new Date(Date.now() - TASK_X402_SIGN_LEASE_MS - 1_000),
      signRiskExpiresAt: new Date(Date.now() - 1_000),
    });

    const result = await resolvePendingTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "node_unreachable",
    });

    expect(result).toMatchObject({ status: "sign_outcome_unresolved" });
    expect(row.status).toBe("PENDING");
    expect(paymentUpdateMock).not.toHaveBeenCalled();
    expect(actionCreateMock).not.toHaveBeenCalled();
  });

  it("fails closed when a PENDING row has neither processing nor risk timing", async () => {
    const row = installRow({ processingAt: null, signRiskExpiresAt: null });

    const result = await resolvePendingTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "node_unreachable",
    });

    expect(result).toMatchObject({ status: "not_resolvable" });
    expect((result as { reason: string }).reason).toMatch(
      /lifetime cannot be proven/,
    );
    expect(row.status).toBe("PENDING");
    expect(paymentUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses a PENDING record that already carries a refund", async () => {
    // Same predicate, same reason as the goodwill lever's: an anomalous
    // PENDING-row-with-a-refund is NOT stopped downstream. The nested create in
    // attachCompensatingRefund re-points the optional FK rather than failing,
    // so both levers would mint a second refund transaction plus a second
    // non-expiring REFUND bucket, orphan the first, and write an audit row
    // saying the operator compensated the user once.
    const row = installRow({ refundTransactionId: "refund_existing" });

    const result = await resolvePendingTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "unsettleable_authorization",
    });

    expect(result).toMatchObject({ status: "not_resolvable" });
    expect((result as { reason: string }).reason).toMatch(
      /already carries a compensating refund/i,
    );
    expect(row.status).toBe("PENDING");
    expect(row.refundTransactionId).toBe("refund_existing");
    expect(paymentUpdateMock).not.toHaveBeenCalled();
    expect(actionCreateMock).not.toHaveBeenCalled();
  });

  it("does NOT call a terminal record with no refund already compensated", async () => {
    // The `already_resolved` guard is (terminal status AND a refund exists).
    // Without the second conjunct, this FAILED row whose refusal refund never
    // landed is reported as already compensated (409) and the operator closes
    // the ticket while the user's credits are still gone.
    installRow({ status: "FAILED", refundTransactionId: null });

    const result = await resolvePendingTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "node_unreachable",
    });

    expect(result).not.toEqual({ status: "already_resolved" });
    expect(result).toEqual({
      status: "not_resolvable",
      reason: "Payment cannot be resolved in status FAILED",
    });
    expect(paymentUpdateMock).not.toHaveBeenCalled();
    expect(actionCreateMock).not.toHaveBeenCalled();
  });

  it("treats a FAILED record as already compensated by the automated refusal refund", async () => {
    installRow({ status: "FAILED", refundTransactionId: "refund_automated" });

    const result = await resolvePendingTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "sign_attempts_exhausted",
    });

    expect(result).toEqual({ status: "already_resolved" });
    expect(paymentUpdateMock).not.toHaveBeenCalled();
    expect(actionCreateMock).not.toHaveBeenCalled();
  });

  it("returns not_found for a missing record", async () => {
    paymentUpdateManyMock.mockResolvedValue({ count: 0 });
    paymentFindUniqueMock.mockResolvedValue(null);

    const result = await resolvePendingTaskX402Payment({
      paymentId: PAYMENT_ID,
      operatorId: OPERATOR_ID,
      reason: "node_unreachable",
    });

    expect(result).toEqual({ status: "not_found" });
    expect(paymentUpdateMock).not.toHaveBeenCalled();
    expect(actionCreateMock).not.toHaveBeenCalled();
  });

  it("writes no audit row when a sign-anomalous debit is refused before any money moves", async () => {
    installRow({ transaction: transaction({ amount: 500n }) });

    await expect(
      resolvePendingTaskX402Payment({
        paymentId: PAYMENT_ID,
        operatorId: OPERATOR_ID,
        reason: "unsettleable_authorization",
      }),
    ).rejects.toThrow(/no debit to refund/);
    expect(actionCreateMock).not.toHaveBeenCalled();
  });
});
