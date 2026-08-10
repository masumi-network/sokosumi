/** RFC 4122 UUID (any version 1–8) with correct variant bits. */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidString(value: string): boolean {
  return UUID_PATTERN.test(value);
}
