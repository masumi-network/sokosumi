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
 * Returns true if the error is a Prisma foreign-key constraint failure (P2003).
 */
export function isPrismaForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2003"
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
 * Returns true if a Prisma P2002 unique violation targets the given field
 * (alone or as part of a composite unique).
 */
function isPrismaUniqueViolationOnField(
  error: unknown,
  field: string,
): boolean {
  if (!isPrismaUniqueViolation(error)) {
    return false;
  }

  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) {
    return target.includes(field);
  }
  if (typeof target === "string") {
    return target.includes(field);
  }

  return false;
}

/**
 * Returns true if the error is a Prisma unique constraint violation (P2002)
 * on the slug field. Used to map race-condition violations to conflict responses.
 */
export function isSlugUniqueConstraintError(error: unknown): boolean {
  return isPrismaUniqueViolationOnField(error, "slug");
}

/**
 * Returns true if the error is a Prisma unique constraint violation (P2002)
 * on `directKey` (including composite `organizationId` + `directKey`).
 */
export function isDirectKeyUniqueConstraintError(error: unknown): boolean {
  return isPrismaUniqueViolationOnField(error, "directKey");
}

/**
 * Returns true if the error is a Prisma unique constraint violation (P2002)
 * on `blockchainIdentifier` (including the composite `network` +
 * `blockchainIdentifier` on TaskPaymentClaim). Scoped on purpose: a bare P2002
 * check would relabel any other unique violation raised in the same
 * transaction as a duplicate payment identifier.
 */
export function isBlockchainIdentifierUniqueConstraintError(
  error: unknown,
): boolean {
  return isPrismaUniqueViolationOnField(error, "blockchainIdentifier");
}
