import { expectConsole } from "@sokosumi/utils/test-console";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { listTasksMock, getTaskByIdMock } = vi.hoisted(() => ({
  listTasksMock: vi.fn(),
  getTaskByIdMock: vi.fn(),
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: { listTasks: listTasksMock, getTaskById: getTaskByIdMock },
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
      },
    ],
    ...overrides,
  };
}

describe("loadProjectResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the Project's done Tasks the reader can see, with each result", async () => {
    listTasksMock.mockResolvedValue({ tasks: [{ id: "1" }, { id: "2" }] });
    getTaskByIdMock.mockImplementation(async (id: string) => task(id));

    const result = await loadProjectResults({ projectId: PROJECT_ID });

    expect(listTasksMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      status: "COMPLETED",
      scope: "workspace",
      sort: "updatedAt",
      limit: 50,
    });
    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: "1",
          name: "Task 1",
          identifier: "SPR-1",
          finishedAt: "2026-11-03T09:00:00.000Z",
          result: "Result 1",
        },
        {
          id: "2",
          name: "Task 2",
          identifier: "SPR-2",
          finishedAt: "2026-11-03T09:00:00.000Z",
          result: "Result 2",
        },
      ],
    });
  });

  it("leaves out a Task that has no result, moved to another Project, reopened or can no longer be read", async () => {
    listTasksMock.mockResolvedValue({
      tasks: [
        { id: "keep" },
        { id: "empty" },
        { id: "moved" },
        { id: "reopened" },
        { id: "gone" },
      ],
    });
    getTaskByIdMock.mockImplementation(async (id: string) => {
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

  it("refuses a malformed Project id without asking Core", async () => {
    const result = await loadProjectResults({ projectId: "../tasks" });

    expect(result).toEqual({ ok: false, error: { code: "BAD_INPUT" } });
    expect(listTasksMock).not.toHaveBeenCalled();
  });

  it("reports a failed list read", async () => {
    listTasksMock.mockRejectedValue(new Error("Core down"));
    const logged = expectConsole("error", "Failed to load Project results");

    const result = await loadProjectResults({ projectId: PROJECT_ID });

    expect(result).toEqual({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR" },
    });
    expect(logged[0]?.[1]).toEqual(new Error("Core down"));
  });
});
