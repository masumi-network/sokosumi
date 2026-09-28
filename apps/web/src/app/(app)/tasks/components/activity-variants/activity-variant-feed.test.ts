import { describe, expect, it } from "vitest";
import { Channel, TaskStatus } from "@/lib/clients/generated/core";
import type { TaskEvent } from "@/lib/clients/generated/core/types.gen";
import {
  type ActivityVariantItem,
  buildDigestItems,
  buildRecentWindowItems,
  buildStatusFoldItems,
} from "./activity-variant-feed";

type Seed = [status: TaskStatus | null, comment: string | null];

// Same shape as the demo thread: runs of status changes between comments,
// three asks for the reader, and a result near the end.
const SEEDS: Seed[] = [
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

function eventsFrom(seeds: Seed[]): TaskEvent[] {
  return seeds.map(([status, comment], index) => {
    const createdAt = new Date(Date.UTC(2026, 8, 1, 0, index));
    return {
      id: `ev-${String(index + 1).padStart(2, "0")}`,
      createdAt,
      updatedAt: createdAt,
      taskId: "task",
      status,
      comment,
      authenticationUrl: null,
      channel: Channel.SOKOSUMI,
      origin: Channel.SOKOSUMI,
      actor: null,
      userId: null,
      user: null,
      coworkerId: null,
      transactionId: null,
      credits: null,
    };
  });
}

function describeItems(items: ActivityVariantItem[]): string[] {
  return items.map((item) => {
    if (item.type === "fold") {
      return `fold(${item.events.map(({ id }) => id.slice(3)).join(",")})`;
    }
    return item.compact ? `~${item.event.id.slice(3)}` : item.event.id.slice(3);
  });
}

const EVENTS = eventsFrom(SEEDS);
const NONE = new Set<string>();

describe("activity variant structures", () => {
  it("leaves five events or fewer alone in every variant", () => {
    const five = EVENTS.slice(0, 5);
    const expected = ["01", "02", "03", "04", "05"];
    for (const build of [
      buildStatusFoldItems,
      buildRecentWindowItems,
      buildDigestItems,
    ]) {
      expect(describeItems(build(five, { openedFolds: NONE }))).toEqual(
        expected,
      );
    }
  });

  it("status folds keep every comment and fold runs of status changes", () => {
    expect(
      describeItems(buildStatusFoldItems(EVENTS, { openedFolds: NONE })),
    ).toEqual([
      "fold(01,02)",
      "03",
      "04",
      "05",
      "fold(06,07)",
      "08",
      "fold(09,10)",
      "11",
      "12",
      "13",
      "fold(14,15)",
      "16",
      "17",
      "18",
      "19",
      "20",
      "21",
      "22",
      "23",
    ]);
  });

  it("opens one status fold without touching the others", () => {
    const items = buildStatusFoldItems(EVENTS, {
      openedFolds: new Set(["ev-06"]),
    });
    expect(describeItems(items).slice(3, 8)).toEqual([
      "05",
      "06",
      "07",
      "08",
      "fold(09,10)",
    ]);
  });

  it("recent window folds older events around the asks", () => {
    expect(
      describeItems(buildRecentWindowItems(EVENTS, { openedFolds: NONE })),
    ).toEqual([
      "fold(01,02,03)",
      "04",
      "fold(05,06,07,08,09,10,11)",
      "12",
      "fold(13,14,15,16,17)",
      "18",
      "19",
      "20",
      "21",
      "22",
      "23",
    ]);
  });

  it("digest shrinks older plain comments and keeps asks in full", () => {
    expect(
      describeItems(
        buildDigestItems(EVENTS, {
          openedFolds: NONE,
          openedComments: new Set(["ev-16"]),
        }),
      ),
    ).toEqual([
      "fold(01,02)",
      "~03",
      "04",
      "~05",
      "fold(06,07)",
      "~08",
      "fold(09,10)",
      "~11",
      "12",
      "~13",
      "fold(14,15)",
      "16",
      "~17",
      "18",
      "19",
      "20",
      "21",
      "22",
      "23",
    ]);
  });
});
