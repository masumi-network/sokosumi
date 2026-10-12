/*
 * The `signup_context` authorize parameter: a JSON object of key to string,
 * number or boolean that a first-party client hands to the account it sends
 * someone to create (ADR 0052). Every entry is untrusted text, so anything
 * malformed is dropped and never blocks a sign-up.
 */

/** A sign-up context's entries, as stored in its `entries` JSON column. */
export type SignUpContextEntries = Record<string, string | number | boolean>;

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_VALUE_LENGTH = 2048;
const MAX_ENTRIES = 10;

function isEntryValue(value: unknown): value is string | number | boolean {
  if (typeof value === "string") return value.length <= MAX_VALUE_LENGTH;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "boolean";
}

/**
 * The valid entries of a `signup_context` parameter, up to 10. A missing,
 * non-JSON or non-object parameter gives no entries.
 */
export function parseSignUpContextEntries(
  raw: string | null,
): SignUpContextEntries {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "");
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const valid = Object.entries(parsed).filter(
    ([key, value]) => KEY_PATTERN.test(key) && isEntryValue(value),
  );
  return Object.fromEntries(valid.slice(0, MAX_ENTRIES));
}
