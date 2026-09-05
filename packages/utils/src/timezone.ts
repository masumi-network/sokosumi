export function isValidTimezone(
  value: string | null | undefined,
): value is string {
  if (!value) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
