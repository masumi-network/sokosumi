import { createFormatter } from "next-intl";
import { describe, expect, it } from "vitest";
import { createFormats } from "@/i18n/time-format";

import {
  formatTaskScheduleTime,
  taskScheduleZoneName,
} from "./task-schedule-view";

function formatterIn(timeZone: string) {
  return createFormatter({
    locale: "en",
    timeZone,
    formats: createFormats("h12"),
  });
}

describe("taskScheduleZoneName", () => {
  it("names the place of the zone", () => {
    expect(taskScheduleZoneName("Europe/Zurich")).toBe("Zurich");
    expect(taskScheduleZoneName("America/Los_Angeles")).toBe("Los Angeles");
    expect(taskScheduleZoneName("UTC")).toBe("UTC");
    expect(taskScheduleZoneName("Etc/GMT+5")).toBe("Etc/GMT+5");
  });
});

describe("formatTaskScheduleTime", () => {
  const run = new Date("2026-11-12T08:00:00.000Z");

  it("reads on the schedule's clock and adds the viewer's when it differs", () => {
    expect(
      formatTaskScheduleTime(
        run,
        "Europe/Zurich",
        formatterIn("America/Los_Angeles"),
      ),
    ).toEqual({
      schedule: "Nov 12, 2026, 9:00 AM",
      local: "Nov 12, 2026, 12:00 AM",
    });
  });

  it("drops the viewer's clock when it reads the same", () => {
    expect(
      formatTaskScheduleTime(
        run,
        "Europe/Zurich",
        formatterIn("Europe/Berlin"),
      ),
    ).toEqual({ schedule: "Nov 12, 2026, 9:00 AM", local: null });
  });
});
