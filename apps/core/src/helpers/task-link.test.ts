import { TaskLinkType, TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  assertTaskLinkAllowed,
  mapTaskLinkForTask,
  mapTaskLinksForTask,
} from "./task-link";

function createLink(
  overrides?: Partial<{
    id: string;
    fromTaskId: string;
    toTaskId: string;
    type: TaskLinkType;
    note: string | null;
    fromTask: {
      id: string;
      name: string;
      status: TaskStatus;
    } | null;
    toTask: {
      id: string;
      name: string;
      status: TaskStatus;
    } | null;
  }>,
) {
  return {
    id: overrides?.id ?? "tl_123",
    createdAt: new Date("2026-03-25T10:00:00.000Z"),
    updatedAt: new Date("2026-03-25T10:00:00.000Z"),
    fromTaskId: overrides?.fromTaskId ?? "tsk_a",
    toTaskId: overrides?.toTaskId ?? "tsk_b",
    type: overrides?.type ?? TaskLinkType.RELATES,
    note: overrides?.note ?? null,
    fromTask: overrides?.fromTask ?? null,
    toTask:
      overrides && "toTask" in overrides
        ? overrides.toTask
        : {
            id: overrides?.toTaskId ?? "tsk_b",
            name: "Task B",
            status: TaskStatus.READY,
          },
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
      fromTaskId: "tsk_a",
      toTaskId: "tsk_b",
      direction: "outgoing",
      peerTaskId: "tsk_b",
      peerTask: {
        id: "tsk_b",
        name: "Task B",
        status: "READY",
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
      fromTaskId: "tsk_a",
      toTaskId: "tsk_b",
      direction: "incoming",
      peerTaskId: "tsk_a",
      peerTask: null,
    });
  });

  it("maps peerTask as null when the peer task is not loaded", () => {
    const result = mapTaskLinkForTask(
      "tsk_a",
      createLink({
        toTask: null,
      }),
    );

    expect(result).toMatchObject({
      id: "tl_123",
      direction: "outgoing",
      peerTaskId: "tsk_b",
      peerTask: null,
    });
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
      direction: "outgoing",
      peerTaskId: "tsk_b",
      peerTask: {
        id: "tsk_b",
        name: "Task B",
        status: "READY",
      },
    });
    expect(result[1]).toMatchObject({
      id: "tl_in",
      direction: "incoming",
      peerTaskId: "tsk_c",
      peerTask: null,
    });
  });
});
