/**
 * Normalizes blank string numeric payloads so `z.coerce.number()` does not
 * treat `""` (or whitespace-only strings) as `0`.
 */
export function preprocessBlankNumericInput(value: unknown): unknown {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }
  return value;
}
