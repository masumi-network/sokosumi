import { describe, expect, it } from "vitest";
import {
  seasonalUpdateHasPassed,
  seoSeasonalTiming,
} from "./seo-seasonal-timing.js";

const leapMonth = {
  targetPeriod: "2028-02",
  historicalVolume: 80,
  baselineMedian: 20,
};
const market = { country: "IN", event: null, windows: [leapMonth] };

describe("seasonal window eligibility", () => {
  it("includes leap day and stops at local midnight, even if another month lacks a measured rise", () => {
    const idea = {
      ...market,
      windows: [
        leapMonth,
        { ...leapMonth, targetPeriod: "2028-03", historicalVolume: 21 },
      ],
    };
    expect(
      seasonalUpdateHasPassed(idea, new Date("2028-02-29T18:29:59Z")),
    ).toBe(false);
    expect(
      seasonalUpdateHasPassed(idea, new Date("2028-02-29T18:30:00Z")),
    ).toBe(true);
  });

  it("uses the event day even if the research also contains an earlier target month", () => {
    const idea = { ...market, event: { date: "2028-03-01" } };
    expect(
      seasonalUpdateHasPassed(idea, new Date("2028-03-01T12:00:00Z")),
    ).toBe(false);
    expect(
      seasonalUpdateHasPassed(idea, new Date("2028-03-01T18:30:00Z")),
    ).toBe(true);
  });

  it("keeps an unknown market's last possible civil day", () => {
    const idea = { ...market, country: "XX" };
    expect(
      seoSeasonalTiming(idea, new Date("2028-03-01T11:59:59Z")).passed,
    ).toBe(false);
    expect(
      seoSeasonalTiming(idea, new Date("2028-03-01T12:00:00Z")).passed,
    ).toBe(true);
  });
});
