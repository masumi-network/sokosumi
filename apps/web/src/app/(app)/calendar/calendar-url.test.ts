import { describe, expect, it } from "vitest";
import { calendarUrl } from "./calendar-url";
import type { CalendarPageSearchParams } from "./load-calendar-page";

describe("calendarUrl", () => {
  it("keeps every param the Calendar reads", () => {
    // Required<...> fails to compile when a param is added without being listed here.
    const all: Required<CalendarPageSearchParams> = {
      assigneeId: "a",
      assigneeUserId: "u",
      date: "2030-01-02",
      projectId: "p",
      scope: "owned",
      types: "contacts",
      status: "READY",
      postStatus: "FAILED",
      provider: "x",
      view: "week",
      timezone: "UTC",
    };

    const query = new URL(calendarUrl(all), "http://x").searchParams;

    expect(Object.fromEntries(query)).toEqual(all);
  });

  it("turns the retired socialOnly switch into types=social", () => {
    expect(calendarUrl({ socialOnly: "true", types: "tasks" })).toBe(
      "/calendar?types=social",
    );
  });

  it("is bare without params", () => {
    expect(calendarUrl({})).toBe("/calendar");
  });
});
