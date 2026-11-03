import { isValidTimezone } from "@sokosumi/utils";
import { Temporal } from "temporal-polyfill";

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

/**
 * The instant a calendar names its zone at: now while today is in the shown
 * period, otherwise noon of the period's first day in that zone. A zone's name
 * changes with daylight saving, so October viewed after the switch says
 * standard time, and a July week viewed in winter still says summer time.
 */
export function calendarZoneInstant({
  firstDayKey,
  lastDayKey,
  now = new Date(),
  timeZone,
}: {
  /** `yyyy-MM-dd`, the period's first day. */
  firstDayKey: string;
  /** `yyyy-MM-dd`, the period's last day. */
  lastDayKey: string;
  now?: Date;
  timeZone: string;
}): Date {
  try {
    const todayKey = Temporal.Instant.fromEpochMilliseconds(now.getTime())
      .toZonedDateTimeISO(timeZone)
      .toPlainDate()
      .toString();
    if (todayKey >= firstDayKey && todayKey <= lastDayKey) return now;
    return new Date(
      Temporal.PlainDate.from(firstDayKey).toZonedDateTime({
        plainTime: "12:00",
        timeZone,
      }).epochMilliseconds,
    );
  } catch {
    return now;
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
