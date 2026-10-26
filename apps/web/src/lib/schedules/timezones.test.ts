import { isValidTimezone } from "@sokosumi/utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatTimezoneLabel, getDefaultTimezone } from "./timezones";

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
