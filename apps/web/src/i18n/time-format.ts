import type { DateTimeFormatOptions } from "next-intl";

import { AUTO_DETECT_VALUE, browserCookieFlags } from "@/i18n/locales";

/** Explicit choice from Account → Preferences. Absent means Auto. */
export const TIME_FORMAT_COOKIE_NAME = "sokosumi.timeformat";
/** What Auto resolves to in this browser, kept current by `TimeFormatSync`. */
export const DETECTED_TIME_FORMAT_COOKIE_NAME = "sokosumi.timeformat.auto";

const TIME_FORMAT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const TIME_FORMATS = ["12h", "24h"] as const;

export type TimeFormat = (typeof TIME_FORMATS)[number];
export type TimeFormatPreference = TimeFormat | typeof AUTO_DETECT_VALUE;

const HOUR_CYCLES = {
  "12h": "h12",
  "24h": "h23",
} as const satisfies Record<TimeFormat, DateTimeFormatOptions["hourCycle"]>;

export type HourCycle = (typeof HOUR_CYCLES)[TimeFormat];

export function parseTimeFormat(
  value: string | null | undefined,
): TimeFormat | null {
  return TIME_FORMATS.find((timeFormat) => timeFormat === value) ?? null;
}

/** Reads one of the time-format cookies from a `document.cookie` string. */
export function readTimeFormatCookie(
  documentCookie: string,
  cookieName: string,
): TimeFormat | null {
  const prefix = `${cookieName}=`;
  const cookie = documentCookie
    .split("; ")
    .find((part) => part.startsWith(prefix));
  return parseTimeFormat(cookie?.slice(prefix.length));
}

export function serializeTimeFormatCookie(timeFormat: TimeFormat): string {
  return `${TIME_FORMAT_COOKIE_NAME}=${timeFormat}; ${browserCookieFlags(TIME_FORMAT_COOKIE_MAX_AGE)}`;
}

export function serializeTimeFormatCookieDelete(): string {
  return `${TIME_FORMAT_COOKIE_NAME}=; ${browserCookieFlags(0)}`;
}

export function serializeDetectedTimeFormatCookie(
  timeFormat: TimeFormat,
): string {
  return `${DETECTED_TIME_FORMAT_COOKIE_NAME}=${timeFormat}; ${browserCookieFlags(TIME_FORMAT_COOKIE_MAX_AGE)}`;
}

/**
 * The browser's own hour cycle for its default locale. Chrome derives it from
 * the browser language region rather than the OS clock (Safari and Firefox
 * follow the OS), which is why the preference also offers explicit values.
 */
export function detectBrowserTimeFormat(): TimeFormat {
  const { hourCycle } = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
  }).resolvedOptions();
  return hourCycle === "h23" || hourCycle === "h24" ? "24h" : "12h";
}

interface TimeFormatCookies {
  /** Value of {@link TIME_FORMAT_COOKIE_NAME}. */
  preference: string | undefined;
  /** Value of {@link DETECTED_TIME_FORMAT_COOKIE_NAME}. */
  detected: string | undefined;
}

/**
 * Hour cycle the request renders times with: the explicit preference, else
 * what Auto detected in this browser, else none so Intl keeps the language's
 * own convention.
 */
export function resolveRequestHourCycle({
  preference,
  detected,
}: TimeFormatCookies): HourCycle | undefined {
  const timeFormat = parseTimeFormat(preference) ?? parseTimeFormat(detected);
  return timeFormat ? HOUR_CYCLES[timeFormat] : undefined;
}

/**
 * The request's next-intl `formats`: one named `dateTime` format per shape of
 * label that shows a clock time. Each carries the hour cycle, so a label picks
 * up the preference by naming its format; labels without a clock time keep
 * ad-hoc options. A call may still override fields such as `year` or
 * `timeZone` through the formatter's third argument.
 */
export function createFormats(hourCycle?: HourCycle) {
  const clock = hourCycle ? { hourCycle } : {};

  return {
    dateTime: {
      time: { hour: "numeric", minute: "2-digit", ...clock },
      timeWithSeconds: {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        ...clock,
      },
      dateTime: {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        ...clock,
      },
      dateTimeWithYear: {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        ...clock,
      },
      dateTimeShort: { dateStyle: "short", timeStyle: "short", ...clock },
      dateTimeMedium: { dateStyle: "medium", timeStyle: "short", ...clock },
      dateTimeWithSeconds: {
        dateStyle: "medium",
        timeStyle: "medium",
        ...clock,
      },
    },
  } satisfies { dateTime: Record<string, DateTimeFormatOptions> };
}
