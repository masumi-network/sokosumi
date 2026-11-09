import { describe, expect, it } from "vitest";

import { normalizeGscBreakdown } from "./native-gsc-breakdown";

const row = (key: string) => ({
  keys: [key],
  clicks: 2,
  impressions: 40,
  ctr: 0.05,
  position: 7.5,
});

describe("normalizeGscBreakdown", () => {
  it("stores countries as alpha-2 and keeps Google's code when none exists", () => {
    const result = normalizeGscBreakdown("country", {
      rows: [row("deu"), row("usa"), row("zzz")],
    });
    expect(result.rows.map((entry) => entry.key)).toEqual(["DE", "US", "ZZZ"]);
    expect(result.rows[0]).toEqual({
      key: "DE",
      clicks: 2,
      impressions: 40,
      ctr: 0.05,
      averagePosition: 7.5,
    });
    expect(result.truncated).toBe(false);
  });

  it("reads devices in any case", () => {
    const result = normalizeGscBreakdown("device", {
      rows: [row("MOBILE"), row("desktop")],
    });
    expect(result.rows.map((entry) => entry.key)).toEqual([
      "mobile",
      "desktop",
    ]);
  });

  it("refuses a duplicate, an unknown device and a different grouping", () => {
    expect(() =>
      normalizeGscBreakdown("country", { rows: [row("deu"), row("DEU")] }),
    ).toThrow("duplicate");
    expect(() =>
      normalizeGscBreakdown("device", { rows: [row("watch")] }),
    ).toThrow("unknown device");
    expect(() =>
      normalizeGscBreakdown("country", {
        rows: [{ ...row("deu"), keys: ["deu", "mobile"] }],
      }),
    ).toThrow("different grouping");
  });
});
