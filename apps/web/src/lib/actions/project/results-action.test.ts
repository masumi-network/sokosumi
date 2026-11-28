import { expectConsole } from "@sokosumi/utils/test-console";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { listTasksMock, getReadableTaskMock } = vi.hoisted(() => ({
  listTasksMock: vi.fn(),
  getReadableTaskMock: vi.fn(),
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    listTasks: listTasksMock,
    getReadableTask: getReadableTaskMock,
  },
}));

import { loadProjectResults } from "./results-action";

const PROJECT_ID = "01960001-0001-7001-8001-000000000001";
const OTHER_PROJECT_ID = "01960001-0001-7001-8001-000000000002";

function task(
  id: string,
  overrides: Partial<{
    projectId: string;
    status: string;
    events: {
      status: string | null;
      comment: string | null;
      createdAt: string;
      actor?: unknown;
    }[];
  }> = {},
) {
  return {
    id,
    name: `Task ${id}`,
    identifier: `SPR-${id}`,
    projectId: PROJECT_ID,
    status: "COMPLETED",
    events: [
      {
        status: "COMPLETED",
        comment: `Result ${id}`,
        createdAt: "2026-11-03T09:00:00.000Z",
        actor: { type: "coworker", coworker: { name: "Elena" } },
      },
    ],
    ...overrides,
  };
}

function onePage(ids: string[]) {
  return {
    tasks: ids.map((id) => ({ id, commentsCount: 1 })),
    pagination: { nextCursor: null },
  };
}

describe("loadProjectResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the Project's done Tasks and subtasks the reader can see, with each result and its author", async () => {
    listTasksMock.mockResolvedValue(onePage(["1"]));
    getReadableTaskMock.mockImplementation(async (id: string) => task(id));

    const result = await loadProjectResults({ projectId: PROJECT_ID });

    expect(listTasksMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      status: "COMPLETED",
      scope: "workspace",
      includeSubtasks: true,
      sort: "createdAt",
      limit: 100,
      cursor: null,
    });
    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: "1",
          name: "Task 1",
          identifier: "SPR-1",
          finishedAt: "2026-11-03T09:00:00.000Z",
          by: "Elena",
          result: "Result 1",
        },
      ],
    });
  });

  it("reads every page, so a result past the first page is not lost", async () => {
    listTasksMock
      .mockResolvedValueOnce({
        tasks: [{ id: "1", commentsCount: 1 }],
        pagination: { nextCursor: "c2" },
      })
      .mockResolvedValueOnce(onePage(["2"]));
    getReadableTaskMock.mockImplementation(async (id: string) => task(id));

    const result = await loadProjectResults({ projectId: PROJECT_ID });

    expect(listTasksMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "c2" }),
    );
    expect(result.ok && result.value.map(({ id }) => id)).toEqual(["1", "2"]);
  });

  it("does not read a Task that has no comment, since it cannot have a result", async () => {
    listTasksMock.mockResolvedValue({
      tasks: [
        { id: "1", commentsCount: 1 },
        { id: "silent", commentsCount: 0 },
      ],
      pagination: { nextCursor: null },
    });
    getReadableTaskMock.mockImplementation(async (id: string) => task(id));

    const result = await loadProjectResults({ projectId: PROJECT_ID });

    expect(getReadableTaskMock).toHaveBeenCalledTimes(1);
    expect(getReadableTaskMock).toHaveBeenCalledWith("1");
    expect(result.ok && result.value.map(({ id }) => id)).toEqual(["1"]);
  });

  it("lists results in the order they finished, oldest first", async () => {
    listTasksMock.mockResolvedValue(onePage(["late", "early"]));
    getReadableTaskMock.mockImplementation(async (id: string) =>
      task(id, {
        events: [
          {
            status: "COMPLETED",
            comment: `Result ${id}`,
            createdAt:
              id === "early"
                ? "2026-11-01T09:00:00.000Z"
                : "2026-11-05T09:00:00.000Z",
          },
        ],
      }),
    );

    const result = await loadProjectResults({ projectId: PROJECT_ID });

    expect(result.ok && result.value.map(({ id }) => id)).toEqual([
      "early",
      "late",
    ]);
  });

  it("leaves out a Task that has no result, moved to another Project, reopened or is gone or hidden", async () => {
    listTasksMock.mockResolvedValue(
      onePage(["keep", "empty", "moved", "reopened", "gone"]),
    );
    getReadableTaskMock.mockImplementation(async (id: string) => {
      if (id === "gone") return null;
      if (id === "empty")
        return task(id, {
          events: [
            {
              status: "COMPLETED",
              comment: null,
              createdAt: "2026-11-03T09:00:00.000Z",
            },
          ],
        });
      if (id === "moved") return task(id, { projectId: OTHER_PROJECT_ID });
      if (id === "reopened") return task(id, { status: "RUNNING" });
      return task(id);
    });

    const result = await loadProjectResults({ projectId: PROJECT_ID });

    expect(result.ok && result.value.map(({ id }) => id)).toEqual(["keep"]);
  });

  it("fails rather than return a partial list when one Task cannot be read", async () => {
    listTasksMock.mockResolvedValue(onePage(["1", "2"]));
    getReadableTaskMock.mockImplementation(async (id: string) => {
      if (id === "2") throw new Error("Core timed out");
      return task(id);
    });
    const logged = expectConsole("error", "Failed to load Project results");

    const result = await loadProjectResults({ projectId: PROJECT_ID });

    expect(result).toEqual({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR" },
    });
    expect(logged[0]?.[1]).toEqual(new Error("Core timed out"));
  });

  it("refuses a malformed Project id without asking Core", async () => {
    const result = await loadProjectResults({ projectId: "../tasks" });

    expect(result).toEqual({ ok: false, error: { code: "BAD_INPUT" } });
    expect(listTasksMock).not.toHaveBeenCalled();
  });
});
