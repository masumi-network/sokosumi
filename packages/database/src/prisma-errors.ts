export function isPrismaUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { code, meta } = error as {
    code?: unknown;
    meta?: {
      code?: unknown;
      driverAdapterError?: {
        cause?: { originalCode?: unknown; kind?: unknown };
      };
    };
  };

  if (code === "P2002") {
    return true;
  }

  if (code === "P2010") {
    const cause = meta?.driverAdapterError?.cause;
    return (
      meta?.code === "23505" ||
      cause?.originalCode === "23505" ||
      cause?.kind === "UniqueConstraintViolation"
    );
  }

  return false;
}
