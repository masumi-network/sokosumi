import { describe, expect, it } from "vitest";

import {
  getCalendarBrowseEnd,
  scheduledSocialPostWhere,
} from "./social-post-range";

const now = new Date("2026-09-01T12:00:00.000Z");

describe("getCalendarBrowseEnd", () => {
  it("keeps the 90-day horizon without a later scheduled post", () => {
    const expected = new Date("2026-11-30T12:00:00.000Z");
    expect(getCalendarBrowseEnd(now, null)).toEqual(expected);
    expect(
      getCalendarBrowseEnd(now, new Date("2026-09-02T12:00:00.000Z")),
    ).toEqual(expected);
  });

  it("includes the latest post's padded month grid in western timezones", () => {
    expect(
      getCalendarBrowseEnd(now, new Date("2027-01-20T12:00:00.000Z")),
    ).toEqual(new Date("2027-02-09T11:59:59.999Z"));
  });

  it("includes the next local month when a UTC+14 post crosses a boundary", () => {
    expect(
      getCalendarBrowseEnd(now, new Date("2027-01-31T12:00:00.000Z")),
    ).toEqual(new Date("2027-03-09T11:59:59.999Z"));
  });
});

describe("scheduledSocialPostWhere", () => {
  it("only includes scheduled and publishing posts in the active workspace", () => {
    expect(scheduledSocialPostWhere("workspace", "user", "workspace")).toEqual({
      workspaceId: "workspace",
      status: { in: ["SCHEDULED", "PUBLISHING"] },
      scheduledAt: { not: null },
    });
  });

  it("narrows owned and project calendars without changing post statuses", () => {
    expect(
      scheduledSocialPostWhere("workspace", "user", "owned", "project"),
    ).toMatchObject({
      workspaceId: "workspace",
      projectId: "project",
      scheduledByUserId: "user",
      status: { in: ["SCHEDULED", "PUBLISHING"] },
    });
  });
});
