import type { Prisma } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";
import { X402_MAX_PLAUSIBLE_VALIDITY_MS } from "@/services/task-x402-payment.finalize";

export interface PurgeExpiredTaskX402PaymentHeadersOptions {
  /** Overridable for tests; defaults to the call time. */
  now?: Date;
  /** Checked before every batch, so the sync deadline can cut the sweep short. */
  abortSignal?: AbortSignal;
}

/**
 * Rows read (and written) per batch. Small enough that one statement is never
 * a long lock, large enough that a normal sweep is one or two round trips.
 */
export const X402_HEADER_PURGE_BATCH_SIZE = 500;

/**
 * How long ANY stored header is kept before it is purged, whatever its
 * `validBefore` column says.
 *
 * Today's writer hard-requires a parseable `validBefore` before any VERIFIED
 * write, but an earlier shape of the parser was best-effort and stored null
 * for a drifted node spelling. That tolerance created rows the expiry sweep
 * could not see at all, and they kept their bearer credential on every pass,
 * forever — and such rows may still exist.
 *
 * The bound is absolute rather than observed, and the arm built on it is
 * UNCONDITIONAL for the same reason. Built DIRECTLY on
 * `X402_MAX_PLAUSIBLE_VALIDITY_MS` — the latest `validBefore` an honestly
 * signed authorization can carry (schema-capped timeout plus clock-skew
 * tolerance) — so the safety inequality "cutoff strictly beyond any live
 * window" holds by construction rather than by two modules deriving from the
 * same cap and a test pinning them together. The extra hour is slack beyond
 * that ceiling.
 *
 * Gating the arm on `validBefore: null` re-derived the bound from the very
 * column it exists to distrust, and left a band nothing covered: an expiry
 * that parses but sits absurdly far in the future (year 5138) is neither
 * `lte: now` nor null, so it matched NEITHER arm and was retained forever.
 * Finalize now fences that value out pre-storage, but the sweep must not
 * depend on the writer for a credential-retention control — and rows written
 * before that fence existed still need collecting.
 *
 * Measured from `updatedAt`, NOT `createdAt`. `createdAt` is the CHARGE time,
 * and a PENDING record stays replayable with the same idempotencyKey, so its
 * header can be signed days later; a createdAt-based cutoff would then null a
 * header that is still settleable. `updatedAt` moves with the VERIFIED write
 * that stores the header, so it is the only field that bounds the credential
 * it carries. Later writes push it further out, which errs toward keeping a
 * live credential slightly longer — the safe direction.
 */
export const X402_UNDATED_HEADER_TTL_MS =
  X402_MAX_PLAUSIBLE_VALIDITY_MS + 60 * 60 * 1000;

/**
 * Housekeeping: drop x402 `X-PAYMENT` headers that can no longer settle.
 *
 * `xPaymentHeader` is written once, at VERIFIED, and was never cleared. That
 * made every verified row a permanently stored BEARER credential: whoever
 * reads it can settle the EIP-3009 authorization it carries against Soko's
 * managed wallet. It is stored at all only so an idempotent replay of the
 * same (taskId, idempotencyKey) can hand back the same result without
 * re-signing — a need that ends the moment the authorization expires.
 *
 * After `validBefore` the header authorizes nothing, so keeping it is pure
 * downside. Null the column and keep everything else: the row, its status,
 * the amount, asset, network, payer, nonce and both transaction links stay
 * put, because those are the payment's audit trail and the future
 * phased-settlement reconciler's input. Only the credential goes.
 *
 * TWO arms, because one was a silent bypass. The `validBefore` arm collects
 * rows PROMPTLY, the moment their known expiry passes. The
 * `X402_UNDATED_HEADER_TTL_MS` arm is the backstop and is ABSOLUTE — it reads
 * only `updatedAt`, so it subsumes null, drifted and far-future expiries
 * alike, without trusting a column an attacker-influenced header wrote.
 *
 * The absolute arm cannot null a live credential: the cutoff is
 * `X402_MAX_PLAUSIBLE_VALIDITY_MS` — the latest expiry an honest sign can
 * carry, measured from the write — plus a full hour of slack, so every
 * header is provably dead before the arm can touch it.
 *
 * Filtered by EXPIRY, not by status. What kills the credential is that it can
 * no longer settle, and status does not decide that. VERIFIED is the only
 * status that writes a header today, but an operator goodwill refund can move
 * such a row to REFUNDED with the header still attached, and a status-scoped
 * sweep would strand exactly those. The predicate also skips rows already
 * purged so a repeat pass rewrites nothing.
 *
 * Batched behind an id cursor. A single unbounded `updateMany` could not be
 * interrupted — `abortSignal` was read once, before the statement — so the
 * sync deadline had no effect on a sweep already in flight. Paging also keeps
 * each write's lock footprint small. The cursor is what guarantees forward
 * progress: the predicate does shrink as rows are cleared, but a scan that
 * relies on that for termination has no answer if a row ever fails to clear.
 *
 * Two round trips per batch (id `findMany`, then `updateMany` over those
 * ids) is a DELIBERATE trade, not an oversight: Prisma's `updateMany` does
 * accept `limit`, but not `orderBy`, so a one-statement batch cannot carry
 * the ascending id cursor — it would have to trust the shrinking predicate
 * for termination, which the paragraph above rejects. Only raw SQL
 * (`UPDATE ... WHERE id IN (SELECT ... ORDER BY id LIMIT n) RETURNING id`)
 * preserves both, and raw SQL against the bearer-credential table is a worse
 * trade than one extra round trip per 500 rows.
 */
export async function purgeExpiredTaskX402PaymentHeaders(
  options: PurgeExpiredTaskX402PaymentHeadersOptions = {},
): Promise<{ purged: number }> {
  const now = options.now ?? new Date();
  const where: Prisma.TaskX402PaymentWhereInput = {
    xPaymentHeader: { not: null },
    OR: [
      { validBefore: { not: null, lte: now } },
      {
        updatedAt: {
          lte: new Date(now.getTime() - X402_UNDATED_HEADER_TTL_MS),
        },
      },
    ],
  };

  let purged = 0;
  let cursor: string | undefined;
  for (;;) {
    if (options.abortSignal?.aborted) {
      break;
    }
    const batch = await prisma.taskX402Payment.findMany({
      where: cursor === undefined ? where : { ...where, id: { gt: cursor } },
      select: { id: true },
      orderBy: { id: "asc" },
      take: X402_HEADER_PURGE_BATCH_SIZE,
    });
    if (batch.length === 0) {
      break;
    }
    const lastId = batch[batch.length - 1]?.id;
    if (lastId === undefined || (cursor !== undefined && lastId <= cursor)) {
      // Unreachable: the page is non-empty, every row has an id, and the scan
      // is ordered ascending from `cursor`. Asserted rather than assumed
      // because this is the loop's only termination guarantee that does not
      // depend on the write below actually clearing rows — and the failure
      // mode of getting it wrong is an unbounded loop against the database.
      break;
    }
    cursor = lastId;

    // Scoped to the ids just read, and still guarded on the column, so a row
    // purged by a concurrent pass between the read and the write is not
    // recounted.
    const result = await prisma.taskX402Payment.updateMany({
      where: {
        id: { in: batch.map((row) => row.id) },
        xPaymentHeader: { not: null },
      },
      data: { xPaymentHeader: null },
    });
    purged += result.count;

    if (batch.length < X402_HEADER_PURGE_BATCH_SIZE) {
      break;
    }
  }
  return { purged };
}

export const taskX402PaymentPurgeService = {
  purgeExpiredTaskX402PaymentHeaders,
};
