import { describe, expect, it } from "vitest";
import {
  formatDatetimeLocalValue,
  isDateValueOutOfBounds,
  normalizeDatetimeLocalValidationBound,
  normalizeDateValidationBound,
  parseDatetimeLocalValue,
} from "@/lib/job-input/date-value";

describe("normalizeDateValidationBound", () => {
  it("keeps YYYY-MM-DD values unchanged", () => {
    expect(normalizeDateValidationBound("2026-03-10")).toBe("2026-03-10");
  });

  it("normalizes datetime-local bounds to day precision", () => {
    expect(normalizeDateValidationBound("2026-03-10T01:30")).toBe("2026-03-10");
    expect(normalizeDateValidationBound("2026-03-10T23:59")).toBe("2026-03-10");
  });

  it("keeps calendar date for timezone-qualified ISO timestamps", () => {
    expect(normalizeDateValidationBound("2026-03-10T00:00:00.000+14:00")).toBe(
      "2026-03-10",
    );
    expect(normalizeDateValidationBound("2026-03-10T23:59:59.999-12:00")).toBe(
      "2026-03-10",
    );
  });

  it("returns undefined for malformed timestamp-like values", () => {
    expect(normalizeDateValidationBound("2026-03-10T")).toBeUndefined();
    expect(
      normalizeDateValidationBound("2026-03-10Tnot-a-time"),
    ).toBeUndefined();
  });

  it("returns undefined for invalid values", () => {
    expect(normalizeDateValidationBound("not-a-date")).toBeUndefined();
  });
});

describe("normalizeDatetimeLocalValidationBound", () => {
  it("keeps valid datetime-local values unchanged", () => {
    expect(normalizeDatetimeLocalValidationBound("2026-03-10T10:30")).toBe(
      "2026-03-10T10:30",
    );
  });

  it("ignores unsupported string bounds", () => {
    expect(
      normalizeDatetimeLocalValidationBound("2026-03-10T10:30:30"),
    ).toBeUndefined();
    expect(
      normalizeDatetimeLocalValidationBound("2026-03-10T10:30:30Z"),
    ).toBeUndefined();
  });

  it("normalizes number/date bounds to datetime-local precision", () => {
    const value = new Date(2026, 2, 10, 10, 30, 15, 250);
    expect(normalizeDatetimeLocalValidationBound(value)).toBe(
      formatDatetimeLocalValue(value),
    );
    expect(normalizeDatetimeLocalValidationBound(value.getTime())).toBe(
      formatDatetimeLocalValue(value),
    );
  });
});

describe("parseDatetimeLocalValue", () => {
  it("parses YYYY-MM-DDTHH:mm as local wall-clock time", () => {
    const parsed = parseDatetimeLocalValue("2026-06-05T14:30");
    expect(parsed).toEqual(new Date(2026, 5, 5, 14, 30));
  });

  it("roundtrips with formatDatetimeLocalValue", () => {
    const original = new Date(2026, 5, 5, 14, 30, 45, 500);
    const formatted = formatDatetimeLocalValue(original);
    const parsed = parseDatetimeLocalValue(formatted);

    expect(parsed).toEqual(new Date(2026, 5, 5, 14, 30));
    expect(formatted).toBe("2026-06-05T14:30");
  });

  it("returns undefined for invalid values", () => {
    expect(parseDatetimeLocalValue("2026-06-05T14:30:00Z")).toBeUndefined();
    expect(parseDatetimeLocalValue("not-a-datetime")).toBeUndefined();
  });
});

describe("isDateValueOutOfBounds", () => {
  it("returns false when value is inside bounds", () => {
    expect(
      isDateValueOutOfBounds("2026-03-10", {
        min: "2026-03-01",
        max: "2026-03-31",
      }),
    ).toBe(false);
  });

  it("returns true when value is below min or above max", () => {
    expect(
      isDateValueOutOfBounds("2026-02-28", {
        min: "2026-03-01",
      }),
    ).toBe(true);
    expect(
      isDateValueOutOfBounds("2026-04-01", {
        max: "2026-03-31",
      }),
    ).toBe(true);
  });
});
