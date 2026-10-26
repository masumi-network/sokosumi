import { describe, expect, it } from "vitest";
import { socialComposeSlot } from "./social-compose-slot";

const NOW = new Date("2030-01-03T10:20:00.000Z");

describe("socialComposeSlot", () => {
  it("proposes the morning of a later day, in the calendar's zone", () => {
    expect(socialComposeSlot("2030-01-04", "Europe/Prague", NOW)).toEqual(
      new Date("2030-01-04T08:00:00.000Z"),
    );
  });

  it("keeps a timeline slot's own time", () => {
    expect(socialComposeSlot("2030-01-03", "UTC", NOW, "15:00")).toEqual(
      new Date("2030-01-03T15:00:00.000Z"),
    );
  });

  it("moves a time already gone today to the next quarter hour, 15 minutes out", () => {
    expect(socialComposeSlot("2030-01-03", "UTC", NOW)).toEqual(
      new Date("2030-01-03T10:45:00.000Z"),
    );
  });

  it("proposes nothing for a day already gone", () => {
    expect(socialComposeSlot("2030-01-02", "UTC", NOW)).toBeNull();
  });
});
