import { SOCIAL_POST_MIN_SCHEDULE_LEAD_MS } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  nextSocialQueueSlotAt,
  socialQueueSlotOccurrence,
} from "./social-queue-slot";

const UTC = "UTC";

function slot(weekday: number, minutesFromMidnight: number, timezone = UTC) {
  return { weekday, minutesFromMidnight, timezone };
}

describe("socialQueueSlotOccurrence", () => {
  it("keeps a later time on the same weekday", () => {
    const from = new Date("2026-09-15T10:00:00.000Z");
    const at = socialQueueSlotOccurrence(slot(2, 11 * 60), from, 0);
    expect(at?.toISOString()).toBe("2026-09-15T11:00:00.000Z");
  });

  it("wraps to the next week when the weekday already passed", () => {
    const from = new Date("2026-09-15T10:00:00.000Z");
    const at = socialQueueSlotOccurrence(slot(1, 9 * 60), from, 0);
    expect(at?.toISOString()).toBe("2026-09-21T09:00:00.000Z");
  });
});

describe("nextSocialQueueSlotAt", () => {
  it("skips past times and the exact minimum lead boundary", () => {
    const from = new Date("2026-09-15T10:00:00.000Z");
    expect(
      nextSocialQueueSlotAt(
        [slot(2, 9 * 60), slot(2, 10 * 60 + 1)],
        [],
        from,
      )?.toISOString(),
    ).toBe("2026-09-22T09:00:00.000Z");
  });

  it("does not shift a nonexistent DST wall time into another slot", () => {
    expect(
      nextSocialQueueSlotAt(
        [slot(0, 2 * 60 + 30, "Europe/Zurich")],
        [],
        new Date("2026-03-28T12:00:00Z"),
      )?.toISOString(),
    ).toBe("2026-04-05T00:30:00.000Z");
  });

  it("uses the winter offset after the DST fallback", () => {
    expect(
      nextSocialQueueSlotAt(
        [slot(0, 9 * 60, "Europe/Zurich")],
        [],
        new Date("2026-10-24T12:00:00Z"),
      )?.toISOString(),
    ).toBe("2026-10-25T08:00:00.000Z");
  });

  it("treats all posts in a slot's minute as occupying it", () => {
    expect(
      nextSocialQueueSlotAt(
        [slot(2, 11 * 60)],
        [new Date("2026-09-15T11:00:30Z")],
        new Date("2026-09-15T10:00:00Z"),
      )?.toISOString(),
    ).toBe("2026-09-22T11:00:00.000Z");
  });

  it("stops after the configured lookahead", () => {
    expect(
      nextSocialQueueSlotAt(
        [slot(2, 11 * 60)],
        [new Date("2026-09-15T11:00:00Z")],
        new Date("2026-09-15T10:00:00Z"),
        60_000,
        1,
      ),
    ).toBeNull();
  });
  it("returns null when there are no slots", () => {
    expect(
      nextSocialQueueSlotAt([], [], new Date("2026-09-15T10:00:00.000Z")),
    ).toBeNull();
  });

  it("picks the next free time after the schedule lead", () => {
    const from = new Date("2026-09-15T10:00:00.000Z");
    const at = nextSocialQueueSlotAt(
      [slot(2, 10 * 60 + 2), slot(3, 9 * 60)],
      [],
      from,
      SOCIAL_POST_MIN_SCHEDULE_LEAD_MS,
    );
    expect(at?.toISOString()).toBe("2026-09-15T10:02:00.000Z");
  });

  it("skips a time that already has a scheduled post", () => {
    const from = new Date("2026-09-15T10:00:00.000Z");
    const taken = new Date("2026-09-15T11:00:00.000Z");
    const at = nextSocialQueueSlotAt(
      [slot(2, 11 * 60), slot(3, 9 * 60)],
      [taken],
      from,
    );
    expect(at?.toISOString()).toBe("2026-09-16T09:00:00.000Z");
  });

  it("reads weekday in the slot timezone", () => {
    const from = new Date("2026-09-15T22:30:00.000Z");
    const at = nextSocialQueueSlotAt(
      [slot(3, 9 * 60, "America/New_York")],
      [],
      from,
    );
    expect(at?.toISOString()).toBe("2026-09-16T13:00:00.000Z");
  });
});
