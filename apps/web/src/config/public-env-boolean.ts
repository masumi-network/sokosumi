import * as z from "zod";

/**
 * Parses `NEXT_PUBLIC_*` booleans from env strings. `z.coerce.boolean()` treats
 * `"false"` as true; this helper matches common env conventions (`true`/`false`,
 * `1`/`0`, empty unset).
 */
export function parsePublicEnvBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true" || normalized === "1") {
    return true;
  }

  if (normalized === "false" || normalized === "0") {
    return false;
  }

  return defaultValue;
}

export function publicEnvBooleanSchema(defaultValue = false) {
  return z
    .string()
    .optional()
    .transform((value) => parsePublicEnvBoolean(value, defaultValue));
}
