import { TaskStatus } from "@sokosumi/database";

import type { TaskWithEvents } from "@/lib/services/task.service";
import { mapTaskToTaskWithCoworker } from "@/lib/utils/task-transformer";

function buildTask(status: TaskStatus): TaskWithEvents {
  return {
    id: "task-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    userId: "user-1",
    organizationId: null,
    coworkerId: null,
    name: "Test task",
    description: null,
    status,
    events: [],
    jobs: [],
  };
}

describe("mapTaskToTaskWithCoworker", () => {
  it("maps canceled tasks to backlog column", () => {
    const task = buildTask(TaskStatus.CANCELED);

    const mapped = mapTaskToTaskWithCoworker(task, new Map(), new Map());

    expect(mapped.columnId).toBe("backlog");
    expect(mapped.status).toBe(TaskStatus.CANCELED);
  });

  it("keeps completed tasks in complete column", () => {
    const task = buildTask(TaskStatus.COMPLETED);

    const mapped = mapTaskToTaskWithCoworker(task, new Map(), new Map());

    expect(mapped.columnId).toBe("complete");
  });
});
