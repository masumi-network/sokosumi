import { TaskStatus } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import type {
  Task,
  TaskListItem,
} from "@/lib/clients/generated/core/types.gen";
import {
  mapTaskToTaskWithCoworker,
  normalizeTaskNameForCoreApi,
} from "@/lib/utils/task-transformer";

function buildTask(
  status: TaskStatus,
  overrides?: Partial<TaskListItem>,
): TaskListItem {
  return {
    id: "task-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    userId: "user-1",
    organizationId: null,
    projectId: null,
    user: { id: "user-1", name: "Test User", image: null },
    organization: null,
    coworkerId: null,
    coworker: null,
    createdByCoworker: null,
    awaitingAcceptance: false,
    name: "Test task",
    description: null,
    status,
    metadata: null,
    nextRunAt: null,
    credits: 0,
    events: [],
    jobs: [],
    workspace: {
      id: "11111111-1111-7111-8111-111111111111",
      organizationId: null,
      organization: null,
    },
    ...overrides,
  };
}

describe("mapTaskToTaskWithCoworker", () => {
  it("maps queued tasks to backlog column", () => {
    const task = buildTask(TaskStatus.QUEUED);

    const mapped = mapTaskToTaskWithCoworker(task, new Map(), new Map());

    expect(mapped.columnId).toBe("backlog");
  });

  it("maps canceled tasks to done column", () => {
    const task = buildTask(TaskStatus.CANCELED);

    const mapped = mapTaskToTaskWithCoworker(task, new Map(), new Map());

    expect(mapped.columnId).toBe("done");
    expect(mapped.status).toBe(TaskStatus.CANCELED);
    expect(mapped.jobsCount).toBe(0);
  });

  it("keeps completed tasks in done column", () => {
    const task = buildTask(TaskStatus.COMPLETED);

    const mapped = mapTaskToTaskWithCoworker(task, new Map(), new Map());

    expect(mapped.columnId).toBe("done");
  });

  it("maps awaiting external tasks to in-progress column", () => {
    const task = buildTask(TaskStatus.AWAITING_EXTERNAL);

    const mapped = mapTaskToTaskWithCoworker(task, new Map(), new Map());

    expect(mapped.columnId).toBe("in-progress");
  });

  it("maps cancel requested tasks to in-progress column", () => {
    const task = buildTask(TaskStatus.CANCEL_REQUESTED);

    const mapped = mapTaskToTaskWithCoworker(task, new Map(), new Map());

    expect(mapped.columnId).toBe("in-progress");
  });

  it("maps out of credits tasks to input-required column", () => {
    const task = buildTask(TaskStatus.OUT_OF_CREDITS);

    const mapped = mapTaskToTaskWithCoworker(task, new Map(), new Map());

    expect(mapped.columnId).toBe("input-required");
  });

  it("serializes Date timestamps to ISO strings", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const updatedAt = new Date("2026-01-01T01:00:00.000Z");
    const nextRunAt = new Date("2026-06-25T09:00:00.000Z");
    const task = buildTask(TaskStatus.READY, {
      createdAt,
      updatedAt,
      nextRunAt,
    });

    const mapped = mapTaskToTaskWithCoworker(task, new Map(), new Map());

    expect(mapped.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(mapped.updatedAt).toBe("2026-01-01T01:00:00.000Z");
    expect(mapped.nextRunAt).toBe("2026-06-25T09:00:00.000Z");
  });

  it("maps jobs count from the API task", () => {
    const task = buildTask(TaskStatus.READY, {
      jobs: [{ id: "job-1" }] as unknown as TaskListItem["jobs"],
    });

    const mapped = mapTaskToTaskWithCoworker(task, new Map(), new Map());

    expect(mapped.jobsCount).toBe(1);
  });

  it("preserves share information from task detail responses", () => {
    const task: Task = {
      ...buildTask(TaskStatus.READY),
      share: {
        id: "share-1",
        taskId: "task-1",
        token: "public-share-token",
        allowSearchIndexing: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      links: [],
    };

    const mapped = mapTaskToTaskWithCoworker(task, new Map(), new Map());

    expect(mapped.share?.token).toBe("public-share-token");
  });

  it("preserves owner information from the API task", () => {
    const task = buildTask(TaskStatus.READY, {
      user: { id: "user-2", name: "Owner Name", image: "ipfs://owner" },
      userId: "user-2",
    });

    const mapped = mapTaskToTaskWithCoworker(task, new Map(), new Map());

    expect(mapped.user).toEqual(task.user);
    expect(mapped.userId).toBe("user-2");
  });
});

describe("normalizeTaskNameForCoreApi", () => {
  it("returns names without surrounding whitespace unchanged", () => {
    expect(normalizeTaskNameForCoreApi("Review onboarding flow")).toBe(
      "Review onboarding flow",
    );
  });

  it("trims surrounding whitespace before returning the name", () => {
    expect(normalizeTaskNameForCoreApi("  Review onboarding flow  ")).toBe(
      "Review onboarding flow",
    );
  });

  it("preserves long names after trimming whitespace", () => {
    const longName = "a".repeat(200);

    expect(normalizeTaskNameForCoreApi(`  ${longName}  `)).toBe(longName);
  });
});
