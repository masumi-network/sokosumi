import { TaskStatus } from "@sokosumi/database";

import { mapTaskToTaskWithCoworker } from "@/lib/utils/task-transformer";

type TaskInput = Parameters<typeof mapTaskToTaskWithCoworker>[0];

function buildTask(
  status: TaskStatus,
  overrides?: Partial<TaskInput>,
): TaskInput {
  return {
    id: "task-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    userId: "user-1",
    organizationId: null,
    coworkerId: null,
    name: "Test task",
    description: null,
    status,
    credits: 0,
    events: [],
    jobs: [],
    ...overrides,
  };
}

describe("mapTaskToTaskWithCoworker", () => {
  it("maps canceled tasks to done column", () => {
    const task = buildTask(TaskStatus.CANCELED);

    const mapped = mapTaskToTaskWithCoworker(task, new Map(), new Map());

    expect(mapped.columnId).toBe("done");
    expect(mapped.status).toBe(TaskStatus.CANCELED);
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
    const task = buildTask(TaskStatus.READY, {
      createdAt,
      updatedAt,
    });

    const mapped = mapTaskToTaskWithCoworker(task, new Map(), new Map());

    expect(mapped.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(mapped.updatedAt).toBe("2026-01-01T01:00:00.000Z");
  });
});
