import { beforeEach, describe, expect, it, vi } from "vitest";

const listProjectsMock = vi.fn();
const listTasksMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { listProjects: listProjectsMock },
}));
vi.mock("@/lib/services/task.service", () => ({
  taskService: { listTasks: listTasksMock },
}));

const { loadProjectsTimeline } = await import("./projects-timeline-data");

function taskPage(id: string, nextCursor: string | null) {
  return {
    tasks: [
      {
        id,
        name: id,
        identifier: null,
        projectId: "p1",
        dueOn: "2026-11-26",
      },
    ],
    pagination: { nextCursor },
  };
}

describe("loadProjectsTimeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listProjectsMock.mockResolvedValue({
      projects: [{ id: "p1", name: "Launch" }],
      pagination: null,
    });
  });

  it("reads the open Tasks the reader can see across the workspace, due by the last week", async () => {
    listTasksMock.mockResolvedValueOnce(taskPage("t1", null));

    const data = await loadProjectsTimeline("2026-11-25");

    expect(listTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "workspace",
        sort: "dueOn",
        dueOnTo: "2027-01-17",
      }),
    );
    const { status } = listTasksMock.mock.calls[0]?.[0] ?? {};
    expect(status).not.toContain("COMPLETED");
    expect(status).not.toContain("CANCELED");
    expect(listProjectsMock).toHaveBeenCalledWith(
      expect.objectContaining({ state: "open" }),
    );
    expect(data.rows[0]?.weeks[0]?.map((task) => task.id)).toEqual(["t1"]);
    expect(data.truncated).toBe(false);
  });

  it("follows the cursor and says so when it stops before the end", async () => {
    listTasksMock.mockImplementation(({ cursor }) =>
      Promise.resolve(
        taskPage(`t-${cursor ?? 0}`, `${Number(cursor ?? 0) + 1}`),
      ),
    );

    const data = await loadProjectsTimeline("2026-11-25");

    expect(listTasksMock).toHaveBeenCalledTimes(5);
    expect(listTasksMock.mock.calls[1]?.[0].cursor).toBe("1");
    expect(data.rows[0]?.weeks[0]).toHaveLength(5);
    expect(data.truncated).toBe(true);
  });
});
