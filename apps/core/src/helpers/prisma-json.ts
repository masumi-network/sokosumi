import { Prisma } from "@sokosumi/database";

/**
 * Convert an arbitrary value into a Prisma JSON-column input.
 *
 * The round trip through `JSON.stringify` is what makes the value JSON: keys
 * holding `undefined` or a function are dropped, `Date` becomes an ISO string,
 * and anything Prisma would reject at query time throws here instead. The
 * assertion afterwards describes a shape the round trip has already produced.
 *
 * Use this where a loose payload or Zod output can carry undefined keys.
 * When a helper or DTO guarantees an already serialized JSON shape, give
 * that shape a Prisma-compatible type instead. See ADR 0035.
 */
export function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Prisma's directive for writing SQL NULL into a nullable `Json?` column. */
type PrismaDbNull = typeof Prisma.NullableJsonNullValueInput.DbNull;

/**
 * Adapt a nullable domain value to a Prisma `Json?` column input.
 *
 * Prisma rejects a bare `null` for a Json column — clearing one needs
 * `Prisma.DbNull`. `undefined` keeps its usual meaning of "leave the column
 * untouched", so a PATCH that omits the field still omits it.
 */
export function nullableJsonInput<T extends Prisma.InputJsonValue>(
  value: T | null | undefined,
): T | PrismaDbNull | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value === null ? Prisma.DbNull : value;
}
