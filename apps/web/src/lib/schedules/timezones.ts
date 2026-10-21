import { isValidTimezone } from "@sokosumi/utils";

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

/** A date-specific zone label; short labels use the full label as their tooltip. */
export function formatTimezoneLabel(
  timezone: string,
  locale: string,
  at: Date,
  style: "long" | "short" = "long",
): string {
  const fallback = timezone.replaceAll("_", " ") || "UTC";
  try {
    const name = new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      timeZoneName: style,
    })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value;
    if (!name) return fallback;
    const city =
      timezone.includes("/") && !timezone.startsWith("Etc/")
        ? timezone.split("/").at(-1)?.replaceAll("_", " ")
        : undefined;
    return style === "long" && city && city !== name
      ? `${name} (${city})`
      : name;
  } catch {
    return fallback;
  }
}

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
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return isValidTimezone(timeZone) ? timeZone : "UTC";
  } catch {
    return "UTC";
  }
}
