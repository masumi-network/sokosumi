import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import de from "../../../../../messages/de.json";
import en from "../../../../../messages/en.json";
import es from "../../../../../messages/es.json";
import { isoWeekOfRow } from "./iso-week";

describe("isoWeekOfRow", () => {
  it("numbers a Monday-start row by its own Monday", () => {
    expect(isoWeekOfRow("2026-10-26")).toBe(44);
  });

  it("numbers a Sunday-start row by the Monday after its Sunday", () => {
    // Sun Oct 25 2026 closes ISO week 43; the row it starts is week 44.
    expect(isoWeekOfRow("2026-10-25")).toBe(44);
  });

  it("keeps Dec 28 2026 to Jan 3 2027 in week 53 across the year boundary", () => {
    expect(isoWeekOfRow("2026-12-28")).toBe(53);
    // Sunday-start: Dec 27 2026 – Jan 2 2027, whose Monday is Dec 28.
    expect(isoWeekOfRow("2026-12-27")).toBe(53);
  });

  it("starts 2027 at week 1 on Monday Jan 4", () => {
    expect(isoWeekOfRow("2027-01-04")).toBe(1);
    // Sunday-start: Jan 3 2027 is the last day of week 53, but its row's
    // Monday is Jan 4.
    expect(isoWeekOfRow("2027-01-03")).toBe(1);
  });

  it("puts a late-December Monday in week 1 of the next year", () => {
    // Mon Dec 30 2024 belongs to ISO week 1 of 2025.
    expect(isoWeekOfRow("2024-12-30")).toBe(1);
    expect(isoWeekOfRow("2024-12-29")).toBe(1);
  });
});

describe("month grid copy", () => {
  it.each([
    ["en", en, "Week 44", "+2 more"],
    ["de", de, "Kalenderwoche 44", "+2 weitere"],
    ["es", es, "Semana 44", "+2 más"],
  ])(
    "names the week and the hidden posts in %s",
    (locale, messages, week, more) => {
      const t = createTranslator({
        locale,
        messages,
        namespace: "App.Calendar",
      });
      expect(t("weekNumber", { week: 44 })).toBe(week);
      expect(t("socialPost.more", { count: 2 })).toBe(more);
    },
  );
});
