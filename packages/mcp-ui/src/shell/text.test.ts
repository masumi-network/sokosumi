import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  formatDay,
  isMessageKey,
  isUnderBase,
  t,
} from "./text.ts";

describe("t", () => {
  it("returns the English message", () => {
    expect(t("shell.error.title")).toBe("This view could not load");
  });

  it("fills named values and leaves unknown ones as written", () => {
    expect(t("hello.title", { name: "Ada" })).toBe("Hello, Ada");
    expect(t("hello.title")).toBe("Hello, {name}");
  });
});

describe("formatDateTime", () => {
  const iso = "2026-11-25T12:00:00Z";
  const spaces = (text: string) => text.replace(/\s/g, " ");

  it("uses the host locale and time zone", () => {
    expect(
      spaces(
        formatDateTime(iso, { locale: "de-DE", timeZone: "Europe/Berlin" }),
      ),
    ).toBe("25.11.2026, 13:00");
    expect(
      spaces(
        formatDateTime(iso, { locale: "en-US", timeZone: "America/New_York" }),
      ),
    ).toBe("Nov 25, 2026, 7:00 AM");
  });

  it("keeps the locale when only the time zone is unknown", () => {
    expect(
      spaces(formatDateTime(iso, { locale: "de-DE", timeZone: "Mars/Base" })),
    ).toMatch(/^25\.11\.2026, /);
  });

  it("falls back to the defaults for an unknown locale or time zone", () => {
    expect(() =>
      formatDateTime(iso, { locale: "not a locale", timeZone: "Mars/Base" }),
    ).not.toThrow();
  });

  it("returns an invalid date as written", () => {
    expect(formatDateTime("soon", {})).toBe("soon");
  });
});

describe("isMessageKey", () => {
  it("tells known keys from others", () => {
    expect(isMessageKey("shell.loading")).toBe(true);
    expect(isMessageKey("shell.nope")).toBe(false);
  });
});

describe("formatDay", () => {
  it("formats a calendar day in the host's locale, whatever its time zone", () => {
    expect(
      formatDay("2026-11-28", {
        locale: "en-US",
        timeZone: "Pacific/Honolulu",
      }),
    ).toBe("Nov 28, 2026");
    expect(formatDay("2026-11-28", { locale: "de-DE" })).toBe("28.11.2026");
  });

  it("falls back for an unknown locale and returns an invalid day as written", () => {
    expect(() =>
      formatDay("2026-11-28", { locale: "not a locale" }),
    ).not.toThrow();
    expect(formatDay("someday", {})).toBe("someday");
  });
});

describe("isUnderBase", () => {
  const base = "https://app.sokosumi.com";

  it("accepts a link on the Web origin", () => {
    expect(isUnderBase("https://app.sokosumi.com/tasks/SOK-1", base)).toBe(
      true,
    );
  });

  it("keeps a base path as a prefix", () => {
    const scoped = "https://example.com/app";
    expect(isUnderBase("https://example.com/app/tasks", scoped)).toBe(true);
    expect(isUnderBase("https://example.com/app", scoped)).toBe(true);
    expect(isUnderBase("https://example.com/apple", scoped)).toBe(false);
  });

  it("rejects other origins, schemes and a missing base", () => {
    expect(isUnderBase("https://app.sokosumi.com.evil.io/x", base)).toBe(false);
    expect(isUnderBase("http://app.sokosumi.com/x", base)).toBe(false);
    expect(isUnderBase("javascript:alert(1)", base)).toBe(false);
    expect(isUnderBase("https://app.sokosumi.com/x", undefined)).toBe(false);
    expect(isUnderBase("https://app.sokosumi.com/x", "javascript:x")).toBe(
      false,
    );
  });
});
