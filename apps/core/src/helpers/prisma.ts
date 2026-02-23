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

  return true;
}
