import { describe, expect, it } from "vitest";
import {
  buildTaskActivityFeedItems,
  findOpenAskEventId,
  getLatestTaskEventId,
  isLatestMatchingStatusEvent,
  isTaskActivityComment,
  mergeTaskActivityEvents,
  sortTaskEventsAscending,
  type TaskActivityFeedItem,
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

type Seed = [status: TaskStatus | null, comment: string | null];

// Runs of status changes between comments, three asks and a result.
const THREAD: Seed[] = [
  [TaskStatus.READY, null],
  [TaskStatus.RUNNING, null],
  [null, "Picked this up"],
  [TaskStatus.INPUT_REQUIRED, "Which URL?"],
  [null, "This one"],
  [TaskStatus.READY, null],
  [TaskStatus.RUNNING, null],
  [null, "Resumed"],
  [TaskStatus.AWAITING_EXTERNAL, null],
  [TaskStatus.RUNNING, null],
  [null, "No 404 in logs"],
  [TaskStatus.INPUT_REQUIRED, "Grant Sentry?"],
  [null, "Granted"],
  [TaskStatus.READY, null],
  [TaskStatus.RUNNING, null],
  [null, "Found it"],
  [null, "Fix is up"],
  [TaskStatus.APPROVAL_REQUIRED, "Approve?"],
  [null, "Approved"],
  [TaskStatus.RUNNING, null],
  [TaskStatus.COMPLETED, "Result"],
  [null, "Thanks"],
  [TaskStatus.INPUT_REQUIRED, "Follow-up?"],
];

function thread(seeds: Seed[]): TaskEvent[] {
  return seeds.map(([status, comment], index) =>
    event(
      `ev-${String(index + 1).padStart(2, "0")}`,
      new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      { status, comment },
    ),
  );
}

function describeItems(items: TaskActivityFeedItem[]): string[] {
  return items.map((item) => {
    if (item.type === "status-fold") {
      return `fold(${item.events.map(({ id }) => id.slice(3)).join(",")})`;
    }
    return item.compact ? `~${item.event.id.slice(3)}` : item.event.id.slice(3);
  });
}

const NONE: ReadonlySet<string> = new Set();

describe("findOpenAskEventId", () => {
  it("is the newest status event when it asks for something", () => {
    expect(
      findOpenAskEventId([
        ...thread(THREAD.slice(0, 4)),
        event("reply", "2026-01-02T00:00:00.000Z", { comment: "Here" }),
      ]),
    ).toBe("ev-04");
  });

  it("is null once the status moves on or ends in a result", () => {
    expect(findOpenAskEventId(thread(THREAD.slice(0, 6)))).toBeNull();
    expect(findOpenAskEventId(thread(THREAD.slice(0, 21)))).toBeNull();
  });
});

describe("buildTaskActivityFeedItems", () => {
  it("renders five events or fewer in full", () => {
    expect(
      describeItems(
        buildTaskActivityFeedItems(thread(THREAD.slice(0, 5)), {
          openedFolds: NONE,
          openedComments: NONE,
        }),
      ),
    ).toEqual(["01", "02", "03", "04", "05"]);
  });

  it("folds status runs and shrinks older comments, answered asks included", () => {
    expect(
      describeItems(
        buildTaskActivityFeedItems(thread(THREAD), {
          openedFolds: NONE,
          openedComments: NONE,
        }),
      ),
    ).toEqual([
      "fold(01,02)",
      "~03",
      "~04",
      "~05",
      "fold(06,07)",
      "~08",
      "fold(09,10)",
      "~11",
      "~12",
      "~13",
      "fold(14,15)",
      "~16",
      "~17",
      "~18",
      "19",
      "20",
      "21",
      "22",
      "23",
    ]);
  });

  it("opens one fold and one comment without touching the rest", () => {
    const items = describeItems(
      buildTaskActivityFeedItems(thread(THREAD), {
        openedFolds: new Set(["ev-06"]),
        openedComments: new Set(["ev-04"]),
      }),
    );
    expect(items.slice(0, 8)).toEqual([
      "fold(01,02)",
      "~03",
      "04",
      "~05",
      "06",
      "07",
      "~08",
      "fold(09,10)",
    ]);
  });

  it("keeps the open ask in full outside the recent window", () => {
    const items = describeItems(
      buildTaskActivityFeedItems(
        thread([
          ...THREAD.slice(0, 12),
          [null, "Looking into access"],
          [null, "Still checking"],
          [null, "Any update?"],
          [null, "Tomorrow"],
          [null, "Thanks"],
          [null, "Ping"],
        ]),
        { openedFolds: NONE, openedComments: NONE },
      ),
    );
    expect(items).toContain("12");
    expect(items).toContain("~04");
  });

  it("keeps results in full outside the recent window", () => {
    expect(
      describeItems(
        buildTaskActivityFeedItems(
          thread([
            [TaskStatus.RUNNING, null],
            [TaskStatus.COMPLETED, "Result"],
            [TaskStatus.RUNNING, null],
            [TaskStatus.FAILED, "It broke"],
            [null, "a"],
            [null, "b"],
            [null, "c"],
            [null, "d"],
            [null, "e"],
          ]),
          { openedFolds: NONE, openedComments: NONE },
        ),
      ),
    ).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09"]);
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
