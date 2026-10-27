import {
  getProjectsByIdCalendarResponseTransformer,
  getWorkspacesCalendarResponseTransformer,
  getWorkspacesCalendarSourcesResponseTransformer,
} from "@sokosumi/core-client/transformers";
import { describe, expect, it } from "vitest";

describe("calendar entry dates", () => {
  it("transforms optional Social horizon dates on calendar sources", async () => {
    const result = await getWorkspacesCalendarSourcesResponseTransformer({
      data: [
        { sourceId: "workspace:workspace-1" },
        { sourceId: "project:empty", latestScheduledSocialPostAt: null },
        {
          sourceId: "project:scheduled",
          latestScheduledSocialPostAt: "2027-02-15T12:00:00.000Z",
          latestScheduledNewsletterIssueAt: "2027-06-15T12:00:00.000Z",
        },
      ],
      meta: { timestamp: "2026-01-10T12:00:00.000Z" },
    });

    expect(result.data[2]?.latestScheduledNewsletterIssueAt).toEqual(
      new Date("2027-06-15T12:00:00.000Z"),
    );
    expect(result.data[0]?.latestScheduledSocialPostAt).toBeUndefined();
    expect(result.data[1]?.latestScheduledSocialPostAt).toBeNull();
    expect(result.data[2]?.latestScheduledSocialPostAt).toEqual(
      new Date("2027-02-15T12:00:00.000Z"),
    );
  });

  it.each([
    getWorkspacesCalendarResponseTransformer,
    getProjectsByIdCalendarResponseTransformer,
  ])("transforms dates for all entry types", async (transform) => {
    const result = await transform({
      data: [
        {
          id: "task",
          scheduledAt: "2026-09-23T12:00:00.000Z",
          originalScheduledAt: "2026-09-23T11:00:00.000Z",
        },
        {
          kind: "socialPost",
          id: "social:post",
          scheduledAt: "2026-09-23T12:00:00.000Z",
        },
        {
          kind: "newsletter_issue",
          id: "newsletter:issue",
          scheduledAt: "2026-09-23T12:00:00.000Z",
        },
      ],
      meta: { timestamp: "2026-09-23T12:00:00.000Z" },
    });
    expect(result.data[0]?.scheduledAt).toBeInstanceOf(Date);
    expect(result.data[0]?.originalScheduledAt).toBeInstanceOf(Date);
    expect(result.data[1]?.scheduledAt).toBeInstanceOf(Date);
    expect(result.data[2]?.scheduledAt).toBeInstanceOf(Date);
    expect(result.data[1]?.originalScheduledAt).toBeUndefined();
  });
});
