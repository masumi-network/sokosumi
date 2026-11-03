import { isValidTimezone } from "@sokosumi/utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  calendarZoneInstant,
  formatTimezoneLabel,
  getDefaultTimezone,
} from "./timezones";

const SUMMER = new Date("2026-10-05T12:00:00Z");
const WINTER = new Date("2026-01-15T12:00:00Z");

describe("formatTimezoneLabel", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [
      "en",
      "Europe/Prague",
      "Central European Summer Time (Prague)",
      "Central European Standard Time (Prague)",
    ],
    [
      "de",
      "Europe/Prague",
      "Mitteleuropäische Sommerzeit (Prague)",
      "Mitteleuropäische Normalzeit (Prague)",
    ],
    [
      "es",
      "Europe/Prague",
      "hora de verano de Europa central (Prague)",
      "hora estándar de Europa central (Prague)",
    ],
    [
      "en",
      "America/New_York",
      "Eastern Daylight Time (New York)",
      "Eastern Standard Time (New York)",
    ],
    [
      "de",
      "America/New_York",
      "Nordamerikanische Ostküsten-Sommerzeit (New York)",
      "Nordamerikanische Ostküsten-Normalzeit (New York)",
    ],
    [
      "es",
      "America/New_York",
      "hora de verano oriental (New York)",
      "hora estándar oriental (New York)",
    ],
  ])(
    "uses the shown date for DST in %s / %s",
    (locale, timezone, summer, winter) => {
      expect(formatTimezoneLabel(timezone, locale, SUMMER)).toBe(summer);
      expect(formatTimezoneLabel(timezone, locale, WINTER)).toBe(winter);
    },
  );

  it.each([
    ["en", "Coordinated Universal Time"],
    ["de", "Koordinierte Weltzeit"],
    ["es", "tiempo universal coordinado"],
  ])("labels UTC and Etc/UTC without a city in %s", (locale, expected) => {
    expect(formatTimezoneLabel("UTC", locale, SUMMER)).toBe(expected);
    expect(formatTimezoneLabel("Etc/UTC", locale, SUMMER)).toBe(expected);
  });

  it.each([
    ["en", "Argentina Standard Time (Buenos Aires)"],
    ["de", "Argentinische Normalzeit (Buenos Aires)"],
    ["es", "hora estándar de Argentina (Buenos Aires)"],
  ])(
    "uses only the last IANA segment for the city in %s",
    (locale, expected) => {
      expect(
        formatTimezoneLabel("America/Argentina/Buenos_Aires", locale, SUMMER),
      ).toBe(expected);
    },
  );

  it("omits city brackets for Etc offsets and ids without a city", () => {
    expect(formatTimezoneLabel("Etc/GMT-2", "en", SUMMER)).toBe("GMT+02:00");
    expect(formatTimezoneLabel("CET", "en", WINTER)).toBe(
      "Central European Standard Time",
    );
  });

  it.each([
    ["en", "America/New_York", "EDT", "EST"],
    ["de", "Europe/Prague", "MESZ", "MEZ"],
    ["es", "Europe/Prague", "CEST", "CET"],
    ["en", "Europe/Prague", "GMT+2", "GMT+1"],
    ["en", "UTC", "UTC", "UTC"],
  ])(
    "provides the date-specific short variant in %s / %s",
    (locale, timezone, summer, winter) => {
      expect(formatTimezoneLabel(timezone, locale, SUMMER, "short")).toBe(
        summer,
      );
      expect(formatTimezoneLabel(timezone, locale, WINTER, "short")).toBe(
        winter,
      );
    },
  );

  it("falls back to a readable id without duplicate brackets for an unknown zone", () => {
    expect(formatTimezoneLabel("Unknown/Big_City", "en", SUMMER)).toBe(
      "Unknown/Big City",
    );
    expect(formatTimezoneLabel("Unknown/Big_City", "en", SUMMER, "short")).toBe(
      "Unknown/Big City",
    );
    expect(formatTimezoneLabel("", "en", SUMMER)).toBe("UTC");
  });

  it("falls back when Intl throws or the date is invalid", () => {
    expect(
      formatTimezoneLabel("Europe/Prague", "en", new Date(Number.NaN)),
    ).toBe("Europe/Prague");
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new RangeError("Intl unavailable");
    });
    expect(formatTimezoneLabel("America/New_York", "en", SUMMER)).toBe(
      "America/New York",
    );
  });

  it("falls back when Intl has no time zone name", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue(
      [],
    );
    expect(formatTimezoneLabel("Europe/Prague", "en", SUMMER)).toBe(
      "Europe/Prague",
    );
  });

  it("does not repeat a name that is already the city", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue([
      { type: "timeZoneName", value: "Prague" },
    ]);
    expect(formatTimezoneLabel("Europe/Prague", "en", SUMMER)).toBe("Prague");
  });
});

describe("calendarZoneInstant", () => {
  const PRAGUE = "Europe/Prague";
  const OCTOBER_2026 = { firstDayKey: "2026-10-01", lastDayKey: "2026-10-31" };
  // Two days after Prague left summer time on 25 October 2026.
  const AFTER_SWITCH = new Date("2026-10-27T09:00:00Z");

  afterEach(() => vi.useRealTimers());

  it.each([
    ["en", "Central European Standard Time (Prague)"],
    ["de", "Mitteleuropäische Normalzeit (Prague)"],
    ["es", "hora estándar de Europa central (Prague)"],
  ])(
    "names today's zone while today is in the shown month (%s)",
    (locale, expected) => {
      const at = calendarZoneInstant({
        ...OCTOBER_2026,
        now: AFTER_SWITCH,
        timeZone: PRAGUE,
      });
      expect(at).toEqual(AFTER_SWITCH);
      expect(formatTimezoneLabel(PRAGUE, locale, at)).toBe(expected);
    },
  );

  it("reads now from the clock by default", () => {
    vi.useFakeTimers();
    vi.setSystemTime(AFTER_SWITCH);
    const at = calendarZoneInstant({ ...OCTOBER_2026, timeZone: PRAGUE });
    expect(formatTimezoneLabel(PRAGUE, "en", at)).toBe(
      "Central European Standard Time (Prague)",
    );
  });

  it.each([
    ["en", "Central European Summer Time (Prague)"],
    ["de", "Mitteleuropäische Sommerzeit (Prague)"],
    ["es", "hora de verano de Europa central (Prague)"],
  ])(
    "names the first day's zone for a month other than today's (%s)",
    (locale, expected) => {
      const at = calendarZoneInstant({
        ...OCTOBER_2026,
        now: new Date("2027-02-10T09:00:00Z"),
        timeZone: PRAGUE,
      });
      // Noon on 1 October in Prague, still summer time (UTC+2).
      expect(at.toISOString()).toBe("2026-10-01T10:00:00.000Z");
      expect(formatTimezoneLabel(PRAGUE, locale, at)).toBe(expected);
    },
  );

  it("names summer time for a July week viewed in winter", () => {
    const at = calendarZoneInstant({
      firstDayKey: "2026-07-12",
      lastDayKey: "2026-07-18",
      now: AFTER_SWITCH,
      timeZone: PRAGUE,
    });
    expect(formatTimezoneLabel(PRAGUE, "en", at)).toBe(
      "Central European Summer Time (Prague)",
    );
    expect(formatTimezoneLabel(PRAGUE, "en", at, "short")).toBe("GMT+2");
  });

  it("decides today in the calendar's zone, not UTC", () => {
    // 23:30 UTC on 31 October is already 1 November in Prague.
    const now = new Date("2026-10-31T23:30:00Z");
    expect(
      calendarZoneInstant({ ...OCTOBER_2026, now, timeZone: PRAGUE }),
    ).not.toEqual(now);
    expect(
      calendarZoneInstant({
        firstDayKey: "2026-11-01",
        lastDayKey: "2026-11-30",
        now,
        timeZone: PRAGUE,
      }),
    ).toEqual(now);
  });
});

describe("getDefaultTimezone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a valid IANA zone", () => {
    expect(isValidTimezone(getDefaultTimezone())).toBe(true);
  });

  it("falls back to UTC when the resolved zone is not a valid IANA id", () => {
    const real = new Intl.DateTimeFormat().resolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      ...real,
      timeZone: "Factory",
    });

    expect(getDefaultTimezone()).toBe("UTC");
  });
});
