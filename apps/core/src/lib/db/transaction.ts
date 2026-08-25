import { Prisma } from "@sokosumi/database";

import { conflict } from "@/helpers/error";
import { isPrismaTransactionConflict } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";

/**
 * Stable error kind for 409s caused by serialization failures. Unlike
 * semantic conflicts (e.g. an idempotency key reused with different
 * parameters), these are transient and safe to retry verbatim.
 */
export const CONCURRENCY_CONFLICT_KIND = "concurrency_conflict";

/**
 * Runs the callback in a Serializable transaction. Postgres aborts such
 * transactions with a serialization failure (Prisma P2034) under concurrent
 * writes; that is an expected, retryable outcome, so it surfaces as a 409
 * conflict with the given message instead of an unhandled 500.
 */
const SERIALIZATION_RETRY_ATTEMPTS = 8;
const SERIALIZATION_RETRY_BASE_MS = 60;
const SERIALIZATION_RETRY_MAX_DELAY_MS = 1_000;

function retryDelayMs(attempt: number): number {
  return (
    Math.min(
      SERIALIZATION_RETRY_BASE_MS * 2 ** attempt,
      SERIALIZATION_RETRY_MAX_DELAY_MS,
    ) +
    Math.random() * 100
  );
}

export async function serializableTransaction<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  conflictMessage: string,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isPrismaTransactionConflict(error)) throw error;
      // Serialization failures are transient: a concurrent writer (for
      // example the turn reconciler heart-beating the same row) won the
      // race. Retry with backoff before surfacing a 409.
      if (attempt + 1 >= SERIALIZATION_RETRY_ATTEMPTS) {
        throw conflict(conflictMessage, { kind: CONCURRENCY_CONFLICT_KIND });
      }
      await new Promise((resolve) =>
        setTimeout(resolve, retryDelayMs(attempt)),
      );
    }
  }
}
