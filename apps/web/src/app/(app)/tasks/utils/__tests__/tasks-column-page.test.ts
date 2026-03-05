jest.mock("server-only", () => ({}));

import { createHmac } from "node:crypto";

import { TaskStatus } from "@sokosumi/database";

import { getTasksColumnPage } from "../tasks-column-page";

const listTasksMock = jest.fn();
const mockCursorSecret = "tasks-cursor-test-secret";

jest.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    BETTER_AUTH_SECRET: mockCursorSecret,
  }),
}));

jest.mock("@/lib/services/task.service", () => ({
  taskService: {
    listTasks: (...args: unknown[]) => listTasksMock(...args),
  },
}));

function buildTask({
  id,
  status,
  updatedAt,
}: {
  id: string;
  status: TaskStatus;
  updatedAt: string;
}) {
  return {
    id,
    name: `Task ${id}`,
    status,
    userId: "user-1",
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
    coworkerId: null,
    description: null,
    events: [],
  } as const;
}

describe("getTasksColumnPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("merges statuses, sorts by updatedAt desc, and keeps opaque cursor state", async () => {
    listTasksMock
      .mockResolvedValueOnce({
        tasks: [
          buildTask({
            id: "task-10",
            status: TaskStatus.COMPLETED,
            updatedAt: "2026-03-01T10:00:00.000Z",
          }),
          buildTask({
            id: "task-07",
            status: TaskStatus.COMPLETED,
            updatedAt: "2026-03-01T07:00:00.000Z",
          }),
        ],
        pagination: { nextCursor: "cursor-completed-1" },
      })
      .mockResolvedValueOnce({
        tasks: [
          buildTask({
            id: "task-09",
            status: TaskStatus.FAILED,
            updatedAt: "2026-03-01T09:00:00.000Z",
          }),
        ],
        pagination: { nextCursor: null },
      })
      .mockResolvedValueOnce({
        tasks: [],
        pagination: { nextCursor: null },
      });

    const firstPage = await getTasksColumnPage({
      columnId: "done",
      cursor: null,
      limit: 2,
      coworkersById: new Map(),
      agentsById: new Map(),
    });

    expect(firstPage.tasks.map((task) => task.id)).toEqual([
      "task-10",
      "task-09",
    ]);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(listTasksMock).toHaveBeenNthCalledWith(1, {
      status: TaskStatus.COMPLETED,
      cursor: null,
      limit: 1,
    });
    expect(listTasksMock).toHaveBeenNthCalledWith(2, {
      status: TaskStatus.FAILED,
      cursor: null,
      limit: 1,
    });
    expect(listTasksMock).toHaveBeenNthCalledWith(3, {
      status: TaskStatus.CANCELED,
      cursor: null,
      limit: 1,
    });

    listTasksMock.mockResolvedValueOnce({
      tasks: [],
      pagination: { nextCursor: null },
    });

    const secondPage = await getTasksColumnPage({
      columnId: "done",
      cursor: firstPage.nextCursor,
      limit: 2,
      coworkersById: new Map(),
      agentsById: new Map(),
    });

    expect(secondPage.tasks.map((task) => task.id)).toEqual(["task-07"]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("falls back to initial state when cursor is invalid", async () => {
    listTasksMock.mockResolvedValue({
      tasks: [],
      pagination: { nextCursor: null },
    });

    const page = await getTasksColumnPage({
      columnId: "backlog",
      cursor: "invalid-cursor",
      limit: 20,
      coworkersById: new Map(),
      agentsById: new Map(),
    });

    expect(page.tasks).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(listTasksMock).toHaveBeenCalledWith({
      status: TaskStatus.DRAFT,
      cursor: null,
      limit: 20,
    });
  });

  it("rejects tampered cursor signatures and falls back to initial state", async () => {
    listTasksMock.mockResolvedValue({
      tasks: [
        buildTask({
          id: "task-1",
          status: TaskStatus.DRAFT,
          updatedAt: "2026-03-01T01:00:00.000Z",
        }),
      ],
      pagination: { nextCursor: "cursor-1" },
    });

    const page = await getTasksColumnPage({
      columnId: "backlog",
      cursor: null,
      limit: 1,
      coworkersById: new Map(),
      agentsById: new Map(),
    });

    expect(page.nextCursor).not.toBeNull();
    listTasksMock.mockClear();

    const [payload, signature] = (page.nextCursor ?? "").split(".");
    const tamperedSignature = `${signature.slice(0, -1)}x`;
    const tamperedCursor = `${payload}.${tamperedSignature}`;

    await getTasksColumnPage({
      columnId: "backlog",
      cursor: tamperedCursor,
      limit: 1,
      coworkersById: new Map(),
      agentsById: new Map(),
    });

    expect(listTasksMock).toHaveBeenCalledWith({
      status: TaskStatus.DRAFT,
      cursor: null,
      limit: 1,
    });
  });

  it("treats legacy unsigned cursor values as invalid and falls back", async () => {
    listTasksMock.mockResolvedValue({
      tasks: [],
      pagination: { nextCursor: null },
    });

    const legacyUnsignedCursor = Buffer.from(
      JSON.stringify({
        version: 1,
        streams: {
          [TaskStatus.DRAFT]: { cursor: "old-cursor", exhausted: false },
        },
        buffer: [],
      }),
      "utf8",
    ).toString("base64url");

    await getTasksColumnPage({
      columnId: "backlog",
      cursor: legacyUnsignedCursor,
      limit: 20,
      coworkersById: new Map(),
      agentsById: new Map(),
    });

    expect(listTasksMock).toHaveBeenCalledWith({
      status: TaskStatus.DRAFT,
      cursor: null,
      limit: 20,
    });
  });

  it("rejects oversized cursor buffers and falls back to initial state", async () => {
    listTasksMock.mockResolvedValue({
      tasks: [],
      pagination: { nextCursor: null },
    });

    const oversizedState = {
      version: 2,
      streams: {
        [TaskStatus.DRAFT]: { cursor: "cursor-1", exhausted: false },
      },
      buffer: Array.from({ length: 501 }, (_, index) => ({
        id: `task-${index}`,
        name: `Task ${index}`,
        status: TaskStatus.DRAFT,
        userId: "user-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        commentsCount: 0,
        columnId: "backlog",
        events: [],
        agents: [],
      })),
    };
    const payload = Buffer.from(
      JSON.stringify(oversizedState),
      "utf8",
    ).toString("base64url");
    const signature = createHmac("sha256", mockCursorSecret)
      .update(payload, "utf8")
      .digest("base64url");

    await getTasksColumnPage({
      columnId: "backlog",
      cursor: `${payload}.${signature}`,
      limit: 20,
      coworkersById: new Map(),
      agentsById: new Map(),
    });

    expect(listTasksMock).toHaveBeenCalledWith({
      status: TaskStatus.DRAFT,
      cursor: null,
      limit: 20,
    });
  });
});
