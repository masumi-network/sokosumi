import { describe, expect, it } from "vitest";
import {
  CMO_CALENDAR_MAX_ENTRIES,
  marketingStrategyPlanSchema,
} from "../project-marketing.js";

describe("a month's calendar", () => {
  it("holds cmo-v14's top month: 504 pieces and room for newsletter issues", () => {
    expect(CMO_CALENDAR_MAX_ENTRIES).toBeGreaterThanOrEqual(504);
    const calendar = marketingStrategyPlanSchema.shape.calendar;
    const entry = {
      id: "e",
      date: "2026-11-23",
      channel: "x",
      format: "post",
      title: "t",
      status: "idea",
    };
    expect(
      calendar.safeParse(Array(CMO_CALENDAR_MAX_ENTRIES).fill(entry)).success,
    ).toBe(true);
    expect(
      calendar.safeParse(Array(CMO_CALENDAR_MAX_ENTRIES + 1).fill(entry))
        .success,
    ).toBe(false);
  });
});
