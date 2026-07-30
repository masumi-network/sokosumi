import { TaskLinkType, TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import type { TaskLinkRow } from "@/types/task-link";

import {
  assertTaskLinkAllowed,
  mapTaskLinkForTask,
  mapTaskLinkRelationToTypeForExistingDirection,
  mapTaskLinkRelationToWriteData,
  mapTaskLinksForTask,
} from "./task-link";

function getTaskName(taskId: string) {
  return `Task ${taskId.split("_").pop()?.toUpperCase() ?? "X"}`;
}

function createLink(
  overrides?: Partial<Omit<TaskLinkRow, "fromTask" | "toTask">> & {
    fromTask?: TaskLinkRow["fromTask"];
    toTask?: TaskLinkRow["toTask"];
  },
): TaskLinkRow {
  return {
    id: overrides?.id ?? "tl_123",
    createdAt: new Date("2026-03-25T10:00:00.000Z"),
    updatedAt: new Date("2026-03-25T10:00:00.000Z"),
    fromTaskId: overrides?.fromTaskId ?? "tsk_a",
    toTaskId: overrides?.toTaskId ?? "tsk_b",
    type: overrides?.type ?? TaskLinkType.RELATES,
    note: overrides?.note ?? null,
    fromTask: {
      id: overrides?.fromTaskId ?? "tsk_a",
      name: getTaskName(overrides?.fromTaskId ?? "tsk_a"),
      status: TaskStatus.READY,
      archivedAt: null,
      ...(overrides?.fromTask ?? {}),
    },
    toTask: {
      id: overrides?.toTaskId ?? "tsk_b",
      name: getTaskName(overrides?.toTaskId ?? "tsk_b"),
      status: TaskStatus.READY,
      archivedAt: null,
      ...(overrides?.toTask ?? {}),
    },
    ...(overrides?.fromTask === null ? { fromTask: null } : {}),
    ...(overrides?.toTask === null ? { toTask: null } : {}),
  };
}

describe("assertTaskLinkAllowed", () => {
  it("rejects self-links", () => {
    expect(() => assertTaskLinkAllowed("tsk_a", "tsk_a")).toThrow(
      "A task cannot link to itself",
    );
  });

  it("allows links between different tasks", () => {
    expect(() => assertTaskLinkAllowed("tsk_a", "tsk_b")).not.toThrow();
  });
});

describe("mapTaskLinkForTask", () => {
  it("maps outgoing links for the current task", () => {
    const result = mapTaskLinkForTask("tsk_a", createLink());

    expect(result).toMatchObject({
      id: "tl_123",
      relation: "related",
      peerTask: {
        id: "tsk_b",
        name: "Task B",
        status: "READY",
        archivedAt: null,
      },
    });
  });

  it("maps incoming links for the current task", () => {
    const result = mapTaskLinkForTask(
      "tsk_b",
      createLink({ fromTaskId: "tsk_a", toTaskId: "tsk_b" }),
    );

    expect(result).toMatchObject({
      id: "tl_123",
      relation: "related",
      peerTask: {
        id: "tsk_a",
        name: "Task A",
        status: "READY",
        archivedAt: null,
      },
    });
  });

  it("throws when the peer task is not loaded", () => {
    expect(() =>
      mapTaskLinkForTask(
        "tsk_a",
        createLink({
          toTask: null,
        }),
      ),
    ).toThrow("Task link tl_123 is missing peerTask");
  });

  it("maps directional block relations relative to the current task", () => {
    expect(
      mapTaskLinkForTask(
        "tsk_a",
        createLink({
          type: TaskLinkType.BLOCKS,
        }),
      ),
    ).toMatchObject({
      relation: "blocks",
    });

    expect(
      mapTaskLinkForTask(
        "tsk_b",
        createLink({
          type: TaskLinkType.BLOCKS,
        }),
      ),
    ).toMatchObject({
      relation: "blocked_by",
    });
  });

  it("maps parent relations relative to the current task", () => {
    expect(
      mapTaskLinkForTask(
        "tsk_a",
        createLink({
          type: TaskLinkType.PARENT,
        }),
      ),
    ).toMatchObject({
      relation: "parent",
    });

    expect(
      mapTaskLinkForTask(
        "tsk_b",
        createLink({
          type: TaskLinkType.PARENT,
        }),
      ),
    ).toMatchObject({
      relation: "child",
    });
  });

  it("maps schedule relations relative to the current task", () => {
    expect(
      mapTaskLinkForTask(
        "tsk_a",
        createLink({
          type: TaskLinkType.SCHEDULE,
        }),
      ),
    ).toMatchObject({
      relation: "schedule_run",
    });

    expect(
      mapTaskLinkForTask(
        "tsk_b",
        createLink({
          type: TaskLinkType.SCHEDULE,
        }),
      ),
    ).toMatchObject({
      relation: "schedule_series",
    });
  });

  it("maps duplicate relations symmetrically", () => {
    expect(
      mapTaskLinkForTask(
        "tsk_a",
        createLink({
          type: TaskLinkType.DUPLICATE,
        }),
      ),
    ).toMatchObject({
      relation: "duplicate",
    });

    expect(
      mapTaskLinkForTask(
        "tsk_b",
        createLink({
          type: TaskLinkType.DUPLICATE,
        }),
      ),
    ).toMatchObject({
      relation: "duplicate",
    });
  });
});

describe("mapTaskLinkRelationToWriteData", () => {
  it("maps a symmetric relation to the current task as the stored source", () => {
    expect(mapTaskLinkRelationToWriteData("tsk_a", "tsk_b", "related")).toEqual(
      {
        fromTaskId: "tsk_a",
        toTaskId: "tsk_b",
        type: TaskLinkType.RELATES,
      },
    );
  });

  it("maps reversed directional relations by flipping the stored edge", () => {
    expect(
      mapTaskLinkRelationToWriteData("tsk_a", "tsk_b", "blocked_by"),
    ).toEqual({
      fromTaskId: "tsk_b",
      toTaskId: "tsk_a",
      type: TaskLinkType.BLOCKS,
    });

    expect(mapTaskLinkRelationToWriteData("tsk_a", "tsk_b", "child")).toEqual({
      fromTaskId: "tsk_b",
      toTaskId: "tsk_a",
      type: TaskLinkType.PARENT,
    });
  });
});

describe("mapTaskLinkRelationToTypeForExistingDirection", () => {
  it("maps relations that fit the existing outgoing direction", () => {
    expect(
      mapTaskLinkRelationToTypeForExistingDirection(
        "tsk_a",
        createLink({ fromTaskId: "tsk_a", toTaskId: "tsk_b" }),
        "parent",
      ),
    ).toBe(TaskLinkType.PARENT);
  });

  it("maps relations that fit the existing incoming direction", () => {
    expect(
      mapTaskLinkRelationToTypeForExistingDirection(
        "tsk_a",
        createLink({ fromTaskId: "tsk_b", toTaskId: "tsk_a" }),
        "child",
      ),
    ).toBe(TaskLinkType.PARENT);
  });

  it("allows related relations from the incoming side of an existing link", () => {
    expect(
      mapTaskLinkRelationToTypeForExistingDirection(
        "tsk_b",
        createLink({ fromTaskId: "tsk_a", toTaskId: "tsk_b" }),
        "related",
      ),
    ).toBe(TaskLinkType.RELATES);
  });

  it("allows duplicate relations from the incoming side of an existing link", () => {
    expect(
      mapTaskLinkRelationToTypeForExistingDirection(
        "tsk_b",
        createLink({ fromTaskId: "tsk_a", toTaskId: "tsk_b" }),
        "duplicate",
      ),
    ).toBe(TaskLinkType.DUPLICATE);
  });

  it("reuses the same stored edge shape as write-data mapping", () => {
    const link = createLink({ fromTaskId: "tsk_a", toTaskId: "tsk_b" });

    expect(
      mapTaskLinkRelationToTypeForExistingDirection("tsk_a", link, "blocks"),
    ).toBe(mapTaskLinkRelationToWriteData("tsk_a", "tsk_b", "blocks").type);
  });

  it("rejects relations that would require reversing the stored edge", () => {
    expect(() =>
      mapTaskLinkRelationToTypeForExistingDirection(
        "tsk_a",
        createLink({ fromTaskId: "tsk_a", toTaskId: "tsk_b" }),
        "child",
      ),
    ).toThrow("Relation child would require reversing the existing link");
  });
});

describe("mapTaskLinksForTask", () => {
  it("maps outgoing and incoming links into one response array", () => {
    const outgoing = createLink({
      id: "tl_out",
      fromTaskId: "tsk_a",
      toTaskId: "tsk_b",
    });
    const incoming = createLink({
      id: "tl_in",
      fromTaskId: "tsk_c",
      toTaskId: "tsk_a",
    });

    const result = mapTaskLinksForTask([outgoing], [incoming]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "tl_out",
      relation: "related",
      peerTask: {
        id: "tsk_b",
        name: "Task B",
        status: "READY",
        archivedAt: null,
      },
    });
    expect(result[1]).toMatchObject({
      id: "tl_in",
      relation: "related",
      peerTask: {
        id: "tsk_c",
        name: "Task C",
        status: "READY",
        archivedAt: null,
      },
    });
  });

  it("throws when a mapped list is missing a peer task relation", () => {
    expect(() =>
      mapTaskLinksForTask(
        [
          createLink({
            toTask: null,
          }),
        ],
        [],
      ),
    ).toThrow("Task link tl_123 is missing peerTask");
  });
});
