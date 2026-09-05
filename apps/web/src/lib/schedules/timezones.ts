const FALLBACK_TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Australia/Sydney",
] as const;

export function getTimezoneOptions(preferred?: string | null): string[] {
  const zones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [...FALLBACK_TIMEZONES];

  const unique = new Set(zones);
  if (preferred) {
    unique.add(preferred);
  }

  return [...unique].sort((left, right) => left.localeCompare(right));
}

export function getDefaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
