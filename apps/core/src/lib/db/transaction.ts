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
export async function serializableTransaction<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  conflictMessage: string,
): Promise<T> {
  try {
    return await prisma.$transaction(callback, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (error) {
    if (isPrismaTransactionConflict(error)) {
      throw conflict(conflictMessage, { kind: CONCURRENCY_CONFLICT_KIND });
    }
    throw error;
  }
}
