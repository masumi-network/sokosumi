import { describe, expect, it } from "vitest";
import {
  buildTaskActivityFeedItems,
  getLatestTaskEventId,
  isLatestMatchingStatusEvent,
  isTaskActivityComment,
  mergeTaskActivityEvents,
  sortTaskEventsAscending,
  TASK_ACTIVITY_VISIBLE_COMMENT_LIMIT,
} from "@/app/tasks/utils/task-activity-feed";
import { Channel, TaskStatus } from "@/lib/clients/generated/core";
import type { TaskEvent } from "@/lib/clients/generated/core/types.gen";

function event(
  id: string,
  createdAt: string,
  fields: Partial<TaskEvent> = {},
): TaskEvent {
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    taskId: "task-1",
    status: null,
    comment: null,
    authenticationUrl: null,
    channel: Channel.SOKOSUMI,
    origin: Channel.SOKOSUMI,
    actor: null,
    userId: null,
    user: null,
    coworkerId: null,
    transactionId: null,
    credits: null,
    ...fields,
  } as TaskEvent;
}

describe("sortTaskEventsAscending", () => {
  it("orders oldest first with id as secondary key", () => {
    const events = [
      event("b", "2026-01-01T12:00:00.000Z"),
      event("a", "2026-01-01T10:00:00.000Z"),
      event("c", "2026-01-01T12:00:00.000Z"),
    ];

    expect(sortTaskEventsAscending(events).map((e) => e.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("getLatestTaskEventId", () => {
  it("returns the chronologically latest event id", () => {
    expect(
      getLatestTaskEventId([
        event("old", "2026-01-01T10:00:00.000Z"),
        event("new", "2026-01-01T12:00:00.000Z"),
      ]),
    ).toBe("new");
  });
});

describe("isLatestMatchingStatusEvent", () => {
  it("matches only the latest event when status aligns", () => {
    const latest = event("latest", "2026-01-01T12:00:00.000Z", {
      status: TaskStatus.AUTHENTICATION_REQUIRED,
    });
    const older = event("older", "2026-01-01T10:00:00.000Z", {
      status: TaskStatus.AUTHENTICATION_REQUIRED,
    });

    expect(
      isLatestMatchingStatusEvent(
        latest,
        "latest",
        TaskStatus.AUTHENTICATION_REQUIRED,
      ),
    ).toBe(true);
    expect(
      isLatestMatchingStatusEvent(
        older,
        "latest",
        TaskStatus.AUTHENTICATION_REQUIRED,
      ),
    ).toBe(false);
  });
});

describe("buildTaskActivityFeedItems", () => {
  it("renders events ascending with no group when comment count <= 5", () => {
    const events = [
      event("c1", "2026-01-01T10:00:00.000Z", { comment: "one" }),
      event("s1", "2026-01-01T11:00:00.000Z", { status: TaskStatus.RUNNING }),
      event("c2", "2026-01-01T12:00:00.000Z", { comment: "two" }),
    ];

    const items = buildTaskActivityFeedItems(events, {
      commentCount: 2,
      commentsExpanded: false,
    });

    expect(
      items.map((item) => ("event" in item ? item.event.id : item.type)),
    ).toEqual(["c1", "s1", "c2"]);
  });

  it("groups older comments when comment count > 5 and keeps non-comments", () => {
    const events = [
      event("c1", "2026-01-01T01:00:00.000Z", { comment: "1" }),
      event("c2", "2026-01-01T02:00:00.000Z", { comment: "2" }),
      event("s1", "2026-01-01T02:30:00.000Z", { status: TaskStatus.RUNNING }),
      event("c3", "2026-01-01T03:00:00.000Z", { comment: "3" }),
      event("c4", "2026-01-01T04:00:00.000Z", { comment: "4" }),
      event("c5", "2026-01-01T05:00:00.000Z", { comment: "5" }),
      event("c6", "2026-01-01T06:00:00.000Z", { comment: "6" }),
      event("c7", "2026-01-01T07:00:00.000Z", { comment: "7" }),
    ];

    const items = buildTaskActivityFeedItems(events, {
      commentCount: 7,
      commentsExpanded: false,
    });

    expect(items[0]).toMatchObject({
      type: "comment-group",
      hiddenCount: 7 - TASK_ACTIVITY_VISIBLE_COMMENT_LIMIT,
    });
    expect(
      items
        .filter((item) => item.type === "event")
        .map((item) => item.event.id),
    ).toEqual(["s1", "c3", "c4", "c5", "c6", "c7"]);
  });

  it("shows no group chrome when expanded", () => {
    const events = Array.from({ length: 6 }, (_, i) =>
      event(`c${i}`, `2026-01-01T0${i}:00:00.000Z`, { comment: String(i) }),
    );

    const items = buildTaskActivityFeedItems(events, {
      commentCount: 6,
      commentsExpanded: true,
    });

    expect(items.every((item) => item.type === "event")).toBe(true);
    expect(items).toHaveLength(6);
  });

  it("counts unloaded older comments in the group", () => {
    const events = [
      event("c6", "2026-01-01T06:00:00.000Z", { comment: "6" }),
      event("c7", "2026-01-01T07:00:00.000Z", { comment: "7" }),
      event("c8", "2026-01-01T08:00:00.000Z", { comment: "8" }),
    ];

    const items = buildTaskActivityFeedItems(events, {
      commentCount: 8,
      commentsExpanded: false,
    });

    expect(items[0]).toMatchObject({
      type: "comment-group",
      hiddenCount: 5,
    });
    expect(
      items
        .filter((item) => item.type === "event")
        .map((item) => item.event.id),
    ).toEqual(["c6", "c7", "c8"]);
  });
});

describe("mergeTaskActivityEvents", () => {
  it("merges and sorts without duplicates", () => {
    const merged = mergeTaskActivityEvents(
      [event("b", "2026-01-01T11:00:00.000Z")],
      [
        event("a", "2026-01-01T10:00:00.000Z"),
        event("b", "2026-01-01T11:00:00.000Z", { comment: "updated" }),
      ],
    );

    expect(merged.map((e) => e.id)).toEqual(["a", "b"]);
    expect(isTaskActivityComment(merged[1]!)).toBe(true);
  });
});
