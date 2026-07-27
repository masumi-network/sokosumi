/**
 * Returns true if the error is any Prisma unique constraint violation (P2002).
 */
export function isPrismaUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  return (error as { code?: unknown }).code === "P2002";
}

/**
 * Returns true when Prisma could not find a required record for an update or
 * delete (P2025). Useful for soft-acking irreversible webhook races such as a
 * Stripe customer whose local owner was deleted before write-back.
 */
export function isPrismaRecordNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2025"
  );
}

/**
 * Returns true when Postgres aborted a transaction due to concurrent writes.
 * Prisma surfaces this as P2034; the pg driver adapter can also raise
 * `DriverAdapterError: TransactionWriteConflict` without a Prisma code.
 */
export function isPrismaTransactionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  if ((error as { code?: unknown }).code === "P2034") {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : "";

  const name =
    error instanceof Error
      ? error.name
      : typeof (error as { name?: unknown }).name === "string"
        ? (error as { name: string }).name
        : "";

  return (
    name === "DriverAdapterError" && /transactionwriteconflict/i.test(message)
  );
}

/**
 * Returns true if the error is a Prisma unique constraint violation (P2002)
 * on the slug field. Used to map race-condition violations to conflict responses.
 */
export function isSlugUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  if (code !== "P2002") {
    return false;
  }

  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) {
    return target.includes("slug");
  }
  if (typeof target === "string") {
    return target.includes("slug");
  }

  return false;
}
