import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import { createTestFormatter } from "@/test/intl-formatter";
import { formatCronScheduleTitle } from "./format";

const formatter = createTestFormatter({ locale: "en-US", hourCycle: "h12" });
const t = createTranslator({
  locale: "en",
  messages: en,
  namespace: "App.Tasks.Schedule",
});

function title(cron: string): string | null {
  return formatCronScheduleTitle(cron, "America/Los_Angeles", formatter, t);
}

describe("formatCronScheduleTitle", () => {
  it("names the shapes whose whole rule the labels carry", () => {
    expect(title("0 9 * * 1")).toBe("Weekly (Monday, 9:00 AM)");
    expect(title("30 17 * * 1-5")).toBe(
      "Weekly (Monday, Tuesday, Wednesday, Thursday, Friday, 5:30 PM)",
    );
    expect(title("0 9 * * *")).toBe("Daily (9:00 AM)");
    expect(title("0 9 1 * *")).toBe("Monthly (day 1, 9:00 AM)");
  });

  it("keeps the cron when the labels would change its meaning", () => {
    // First Monday of each month, not every Monday.
    expect(title("0 10 * * 1#1")).toBeNull();
    // Days 1 and 3 of each month, not every 2 days.
    expect(title("0 9 1,3 * *")).toBeNull();
    // Last Friday, last day of the month, every 30 minutes, every 2 months.
    expect(title("0 9 * * 5L")).toBeNull();
    expect(title("0 9 L * *")).toBeNull();
    expect(title("*/30 7-19 * * 1-5")).toBeNull();
    expect(title("0 9 1 */2 *")).toBeNull();
  });
});
