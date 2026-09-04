import { describe, expect, it } from "vitest";
import { mapTaskToTaskWithCoworker } from "@/app/tasks/utils/task-view-model";
import { TaskStatus } from "@/lib/clients/generated/core";
import type {
  Task,
  TaskListItem,
} from "@/lib/clients/generated/core/types.gen";

function buildTask(
  status: TaskStatus,
  overrides?: Partial<TaskListItem>,
): TaskListItem {
  return {
    id: "task-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ownerId: "user-1",
    organizationId: null,
    projectId: null,
    owner: { id: "user-1", name: "Test User", image: null },
    userId: "user-1",
    user: { id: "user-1", name: "Test User", image: null },
    organization: null,
    assigneeId: null,
    assigneeSokoBotId: null,
    assignee: null,
    coworkerId: null,
    coworker: null,
    creator: {
      type: "user",
      id: "user-1",
      user: { id: "user-1", name: "Test User", image: null },
    },
    sokoBotId: null,
    sokoBot: null,
    name: "Test task",
    description: null,
    status,
    metadata: null,
    nextRunAt: null,
    scheduleRevision: 0,
    commentsCount: 0,
    jobsCount: 0,
    grantResumeStatus: null,
    pendingVendorGrantId: null,
    workspace: {
      id: "11111111-1111-7111-8111-111111111111",
      organizationId: null,
      organization: null,
    },
    ...overrides,
  };
}

const PERSONAL_ASSISTANT = "Personal assistant";

function map(task: TaskListItem | Task) {
  return mapTaskToTaskWithCoworker(
    task,
    new Map(),
    new Map(),
    PERSONAL_ASSISTANT,
  );
}

describe("mapTaskToTaskWithCoworker", () => {
  it("maps queued tasks to backlog column", () => {
    const task = buildTask(TaskStatus.QUEUED);

    const mapped = map(task);

    expect(mapped.columnId).toBe("backlog");
  });

  it("maps canceled tasks to done column", () => {
    const task = buildTask(TaskStatus.CANCELED);

    const mapped = map(task);

    expect(mapped.columnId).toBe("done");
    expect(mapped.status).toBe(TaskStatus.CANCELED);
    expect(mapped.jobsCount).toBe(0);
  });

  it("keeps completed tasks in done column", () => {
    const task = buildTask(TaskStatus.COMPLETED);

    const mapped = map(task);

    expect(mapped.columnId).toBe("done");
  });

  it("maps awaiting external tasks to in-progress column", () => {
    const task = buildTask(TaskStatus.AWAITING_EXTERNAL);

    const mapped = map(task);

    expect(mapped.columnId).toBe("in-progress");
  });

  it("maps out of credits tasks to input-required column", () => {
    const task = buildTask(TaskStatus.OUT_OF_CREDITS);

    const mapped = map(task);

    expect(mapped.columnId).toBe("input-required");
  });

  it("maps GRANT_PENDING tasks to input-required", () => {
    const task = buildTask(TaskStatus.GRANT_PENDING, {
      grantResumeStatus: TaskStatus.READY,
    });

    const mapped = map(task);

    expect(mapped.columnId).toBe("input-required");
    expect(mapped.status).toBe(TaskStatus.GRANT_PENDING);
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

    const mapped = map(task);

    expect(mapped.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(mapped.updatedAt).toBe("2026-01-01T01:00:00.000Z");
    expect(mapped.nextRunAt).toBe("2026-06-25T09:00:00.000Z");
  });

  it("maps counts from the list API task", () => {
    const task = buildTask(TaskStatus.READY, {
      commentsCount: 2,
      jobsCount: 1,
    });

    const mapped = map(task);

    expect(mapped.jobsCount).toBe(1);
    expect(mapped.commentsCount).toBe(2);
    expect(mapped.events).toEqual([]);
  });

  it("preserves share information from task detail responses", () => {
    const task: Task = {
      ...buildTask(TaskStatus.READY),
      credits: 0,
      events: [],
      jobs: [],
      files: [],
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

    const mapped = map(task);

    expect(mapped.share?.token).toBe("public-share-token");
  });

  it("preserves owner information from the API task", () => {
    const task = buildTask(TaskStatus.READY, {
      owner: { id: "user-2", name: "Owner Name", image: "ipfs://owner" },
      ownerId: "user-2",
    });

    const mapped = map(task);

    expect(mapped.owner).toEqual(task.owner);
    expect(mapped.ownerId).toBe("user-2");
  });

  it("maps an orchestrator assignee without looking it up in coworkers", () => {
    const task = buildTask(TaskStatus.READY, {
      assigneeId: null,
      assigneeSokoBotId: "bot-1",
      assignee: {
        type: "orchestrator",
        id: "bot-1",
        sokoBot: {
          id: "bot-1",
          name: "Jarvis",
          avatarSeed: "orb:jewel-sky:user-1",
          avatarImageUrl: null,
          owner: { id: "user-1", name: "Ada", image: null },
        },
      },
    });

    const mapped = map(task);

    expect(mapped.assignee).toEqual({
      id: "bot-1",
      name: "Jarvis",
      image: null,
      kind: "orchestrator",
      avatarSeed: "orb:jewel-sky:user-1",
    });
  });

  it("uses the translated fallback when the orchestrator has no name", () => {
    const task = buildTask(TaskStatus.READY, {
      assigneeId: null,
      assigneeSokoBotId: "bot-1",
      assignee: {
        type: "orchestrator",
        id: "bot-1",
        sokoBot: {
          id: "bot-1",
          name: "  ",
          avatarSeed: null,
          avatarImageUrl: null,
          owner: { id: "user-1", name: "Ada", image: null },
        },
      },
    });

    expect(map(task).assignee?.name).toBe(PERSONAL_ASSISTANT);
  });
});
