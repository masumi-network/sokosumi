import { X402_MAX_TIMEOUT_SECONDS } from "@sokosumi/masumi/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { paymentFindManyMock, paymentUpdateManyMock } = vi.hoisted(() => ({
  paymentFindManyMock: vi.fn(),
  paymentUpdateManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskX402Payment: {
      findMany: paymentFindManyMock,
      updateMany: paymentUpdateManyMock,
    },
  },
}));

import {
  purgeExpiredTaskX402PaymentHeaders,
  X402_HEADER_PURGE_BATCH_SIZE,
  X402_UNDATED_HEADER_TTL_MS,
} from "./task-x402-payment.purge";

const NOW = new Date("2026-06-01T12:00:00.000Z");
const UNDATED_CUTOFF = new Date(NOW.getTime() - X402_UNDATED_HEADER_TTL_MS);

/** One page of ids, as the cursor scan would read them. */
function idPage(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    id: `pay_${String(offset + index).padStart(5, "0")}`,
  }));
}

function firstWhere() {
  return paymentFindManyMock.mock.calls[0]?.[0]?.where;
}

/** A row as the sweep's predicate sees it. */
interface PurgeRow {
  xPaymentHeader: string | null;
  validBefore: Date | null;
  updatedAt: Date;
}

/**
 * Evaluates one field condition the way Prisma would, for the three operator
 * shapes this predicate actually uses: a literal `null`, `{ not: null }`, and
 * `{ lte: Date }`.
 *
 * Asserting the `where` OBJECT proves the predicate is the one that was
 * written; it cannot prove which rows that predicate selects, and the bug this
 * covers is exactly a row nobody realised the predicate misses. So the rows
 * are run through it.
 */
function matchesCondition(
  condition: unknown,
  value: Date | string | null,
): boolean {
  if (condition === null) {
    return value === null;
  }
  if (typeof condition !== "object") {
    return condition === value;
  }
  const operators = condition as { not?: unknown; lte?: Date };
  if ("not" in operators && operators.not === null && value === null) {
    return false;
  }
  if (operators.lte !== undefined) {
    return value instanceof Date && value.getTime() <= operators.lte.getTime();
  }
  return true;
}

function purgeSelects(row: PurgeRow): boolean {
  const where = firstWhere();
  if (!matchesCondition(where.xPaymentHeader, row.xPaymentHeader)) {
    return false;
  }
  return (where.OR as Record<string, unknown>[]).some((arm) =>
    Object.entries(arm).every(([field, condition]) =>
      matchesCondition(condition, row[field as keyof PurgeRow]),
    ),
  );
}

describe("purgeExpiredTaskX402PaymentHeaders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paymentFindManyMock.mockResolvedValue([]);
    paymentUpdateManyMock.mockResolvedValue({ count: 0 });
  });

  it("nulls the header on every row whose authorization has expired", async () => {
    paymentFindManyMock.mockResolvedValueOnce(idPage(4));
    paymentUpdateManyMock.mockResolvedValue({ count: 4 });

    const result = await purgeExpiredTaskX402PaymentHeaders({ now: NOW });

    expect(result).toEqual({ purged: 4 });
    expect(firstWhere()).toEqual({
      xPaymentHeader: { not: null },
      OR: [
        { validBefore: { not: null, lte: NOW } },
        { updatedAt: { lte: UNDATED_CUTOFF } },
      ],
    });
  });

  it("keeps the row and every money fact — only the credential goes", async () => {
    paymentFindManyMock.mockResolvedValueOnce(idPage(1));

    await purgeExpiredTaskX402PaymentHeaders({ now: NOW });

    const [call] = paymentUpdateManyMock.mock.calls;
    // A delete, or any write touching status/amount/asset/transactionId,
    // would destroy the payment's audit trail. The purge drops one column.
    expect(call?.[0]?.data).toEqual({ xPaymentHeader: null });
  });

  it("never touches a row whose authorization is still live", async () => {
    await purgeExpiredTaskX402PaymentHeaders({ now: NOW });

    // `lte` and not `gte`/absent: a header inside its validBefore window is
    // the instrument the coworker is still entitled to settle with.
    expect(firstWhere().OR[0]).toEqual({
      validBefore: { not: null, lte: NOW },
    });
  });

  it("purges by expiry rather than by status", async () => {
    await purgeExpiredTaskX402PaymentHeaders({ now: NOW });

    // What makes the credential dead is that it can no longer settle, not
    // which status the row landed in. VERIFIED is the only status that writes
    // a header today, but a later goodwill refund can move such a row to
    // REFUNDED with the header still on it — scoping to VERIFIED would strand
    // exactly those.
    expect(firstWhere()).not.toHaveProperty("status");
  });

  it("also purges rows whose validBefore never decoded, on an absolute bound", async () => {
    // The bypass. An earlier parser shape was best-effort — a drifted
    // spelling ("0x67f1a2b3", "1e9", absent) stored null rather than failing a
    // payment the node already signed — and the sweep required
    // `validBefore: { not: null }`. So the purge did not cover the rows that
    // tolerance created: those kept a live-looking bearer credential on every
    // pass, forever. Today's writer hard-fails an unparseable validBefore, but
    // legacy null rows may still exist and a credential-retention control must
    // not depend on writer discipline — the absolute arm stays unconditional.
    await purgeExpiredTaskX402PaymentHeaders({ now: NOW });

    expect(firstWhere().OR).toContainEqual({
      updatedAt: { lte: UNDATED_CUTOFF },
    });
    expect(
      purgeSelects({
        xPaymentHeader: "eyJ…",
        validBefore: null,
        updatedAt: new Date(UNDATED_CUTOFF.getTime() - 1),
      }),
    ).toBe(true);
  });

  it("purges a far-future validBefore that outlived the write which stored it", async () => {
    // The band BETWEEN the two arms. `readUnixSeconds` rejects only what
    // overflows the JS Date range, so "99999999999" (Wed Nov 16 5138) and
    // "253402300799" (Sat Jan 01 10000) both parse and both get stored
    // verbatim. Such a row is not `lte: now`, so arm 1 misses it — and its
    // `validBefore` is not null, so an arm 2 gated on `validBefore: null`
    // missed it too. The bearer credential was then retained on every pass,
    // forever, and it permanently blinds `@@index([status, validBefore])` for
    // the reconciler while accumulating in the partial purge index.
    //
    // No honest node can mint one (maxTimeoutSeconds is capped at
    // X402_MAX_TIMEOUT_SECONDS), which is exactly why the second arm must be
    // ABSOLUTE rather than trusting the column.
    await purgeExpiredTaskX402PaymentHeaders({ now: NOW });

    for (const seconds of [99_999_999_999, 253_402_300_799]) {
      expect(
        purgeSelects({
          xPaymentHeader: "eyJ…",
          validBefore: new Date(seconds * 1000),
          updatedAt: new Date(UNDATED_CUTOFF.getTime() - 1),
        }),
      ).toBe(true);
    }
  });

  it("still cannot null a header that is genuinely live", async () => {
    // The absolute arm's licence to ignore `validBefore` rests entirely on
    // this: `maxTimeoutSeconds` is capped, the node signs
    // `validBefore = signTime + maxTimeoutSeconds`, and `updatedAt` moves with
    // the VERIFIED write that stored the header — so a header still inside its
    // window is at most X402_MAX_TIMEOUT_SECONDS old, while the cutoff sits an
    // extra hour beyond that.
    await purgeExpiredTaskX402PaymentHeaders({ now: NOW });

    expect(
      purgeSelects({
        xPaymentHeader: "eyJ…",
        validBefore: new Date(NOW.getTime() + 30 * 60 * 1000),
        updatedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      }),
    ).toBe(false);
    // The oldest a live authorization's row can be, to the millisecond.
    expect(
      purgeSelects({
        xPaymentHeader: "eyJ…",
        validBefore: new Date(NOW.getTime() + 1),
        updatedAt: new Date(NOW.getTime() - X402_MAX_TIMEOUT_SECONDS * 1000),
      }),
    ).toBe(false);
  });

  it("leaves a row that has already been purged alone", async () => {
    await purgeExpiredTaskX402PaymentHeaders({ now: NOW });

    expect(
      purgeSelects({
        xPaymentHeader: null,
        validBefore: null,
        updatedAt: new Date(0),
      }),
    ).toBe(false);
  });

  it("bounds the undated fallback by the longest authorization a 402 can mint", async () => {
    // maxTimeoutSeconds is capped at X402_MAX_TIMEOUT_SECONDS, and the node
    // signs validBefore = signTime + maxTimeoutSeconds — so no authorization
    // can outlive its row's last write by more than that. The fallback must
    // sit strictly beyond it, or the sweep would null a header that is still
    // settleable.
    expect(X402_UNDATED_HEADER_TTL_MS).toBeGreaterThan(
      X402_MAX_TIMEOUT_SECONDS * 1000,
    );
  });

  // No pin against X402_MAX_PLAUSIBLE_VALIDITY_MS here: the TTL is now
  // DERIVED from it by direct import (fence + one hour), so the ordering
  // holds by construction and a test would be tautological.

  it("measures the undated fallback from the last write, not the row's birth", async () => {
    // createdAt is the CHARGE time. A PENDING record is replayable with the
    // same idempotencyKey for as long as it stays PENDING, so its header can
    // be signed days after the row was created — and a createdAt-based cutoff
    // would then null a header that is still live. updatedAt moves with the
    // VERIFIED write that stores the header, so it is the only field that
    // bounds the authorization it carries.
    await purgeExpiredTaskX402PaymentHeaders({ now: NOW });

    const undated = firstWhere().OR[1];
    expect(undated).not.toHaveProperty("createdAt");
    expect(undated.updatedAt).toEqual({ lte: UNDATED_CUTOFF });
  });

  it("walks the matches in id-cursor batches instead of one unbounded write", async () => {
    // One `updateMany` over the whole match set is an unbounded write with no
    // way to stop it: `abortSignal` was only read before the statement, so the
    // sync deadline could not cut it short once it started.
    paymentFindManyMock
      .mockResolvedValueOnce(idPage(X402_HEADER_PURGE_BATCH_SIZE))
      .mockResolvedValueOnce(idPage(2, X402_HEADER_PURGE_BATCH_SIZE))
      .mockResolvedValue([]);
    paymentUpdateManyMock
      .mockResolvedValueOnce({ count: X402_HEADER_PURGE_BATCH_SIZE })
      .mockResolvedValueOnce({ count: 2 });

    const result = await purgeExpiredTaskX402PaymentHeaders({ now: NOW });

    expect(result).toEqual({ purged: X402_HEADER_PURGE_BATCH_SIZE + 2 });
    expect(paymentFindManyMock).toHaveBeenCalledTimes(2);
    // Ordered and paged, so the scan makes forward progress by construction.
    expect(paymentFindManyMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        orderBy: { id: "asc" },
        take: X402_HEADER_PURGE_BATCH_SIZE,
        select: { id: true },
      }),
    );
    // The second page resumes strictly after the last id of the first.
    const lastOfFirstPage = `pay_${String(X402_HEADER_PURGE_BATCH_SIZE - 1).padStart(5, "0")}`;
    expect(paymentFindManyMock.mock.calls[1]?.[0]?.where?.id).toEqual({
      gt: lastOfFirstPage,
    });
    // Each write is scoped to the ids just read, never to the open predicate.
    expect(
      paymentUpdateManyMock.mock.calls[1]?.[0]?.where?.id?.in,
    ).toHaveLength(2);
    // ...and every write still re-guards on the column. The ids were selected
    // by a predicate evaluated at READ time; by write time a concurrent pass
    // may already have cleared some of them, and `updateMany` reports the rows
    // it MATCHED. Without this guard those rows match again, count again, and
    // the reported `purged` total overstates the credentials this sweep
    // actually removed. Metrics-only — no credential, money, or audit
    // consequence — which is why nothing else here notices it going missing.
    for (const call of paymentUpdateManyMock.mock.calls) {
      expect(call[0]?.where?.xPaymentHeader).toEqual({ not: null });
    }
  });

  it("stops between batches when the sync deadline fires mid-sweep", async () => {
    const controller = new AbortController();
    paymentFindManyMock.mockResolvedValue(idPage(X402_HEADER_PURGE_BATCH_SIZE));
    paymentUpdateManyMock.mockImplementation(async () => {
      // The deadline lands while the first batch is being written.
      controller.abort();
      return { count: X402_HEADER_PURGE_BATCH_SIZE };
    });

    const result = await purgeExpiredTaskX402PaymentHeaders({
      now: NOW,
      abortSignal: controller.signal,
    });

    // The work already committed is kept and reported; nothing further starts.
    expect(result).toEqual({ purged: X402_HEADER_PURGE_BATCH_SIZE });
    expect(paymentUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(paymentFindManyMock).toHaveBeenCalledTimes(1);
  });

  it("skips the write when the sync deadline already fired", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await purgeExpiredTaskX402PaymentHeaders({
      now: NOW,
      abortSignal: controller.signal,
    });

    expect(result).toEqual({ purged: 0 });
    expect(paymentFindManyMock).not.toHaveBeenCalled();
    expect(paymentUpdateManyMock).not.toHaveBeenCalled();
  });

  it("defaults `now` to the current time", async () => {
    const before = Date.now();

    await purgeExpiredTaskX402PaymentHeaders();

    const lte = firstWhere().OR[0].validBefore.lte as Date;
    expect(lte.getTime()).toBeGreaterThanOrEqual(before);
    expect(lte.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
