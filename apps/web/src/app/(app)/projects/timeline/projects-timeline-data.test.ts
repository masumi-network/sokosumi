import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listProjectsMock = vi.fn();
const listTasksMock = vi.fn();
const connectionMock = vi.fn(async () => undefined);

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => undefined }));
vi.mock("next/server", () => ({ connection: () => connectionMock() }));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { listProjects: listProjectsMock },
}));
vi.mock("@/lib/services/task.service", () => ({
  taskService: { listTasks: listTasksMock },
}));

const { loadProjectsTimeline } = await import("./projects-timeline-data");

function taskPage(
  id: string,
  nextCursor: string | null,
  projectId: string | null = "p1",
) {
  return {
    tasks: [
      {
        id,
        name: id,
        identifier: null,
        projectId,
        dueOn: "2026-11-26",
      },
    ],
    pagination: { nextCursor },
  };
}

describe("loadProjectsTimeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 2026-11-25 10:00 UTC, a Wednesday.
    vi.useFakeTimers({ now: new Date("2026-11-25T10:00:00.000Z") });
    listProjectsMock.mockResolvedValue({
      projects: [{ id: "p1", name: "Launch" }],
      pagination: { nextCursor: null },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // connection() would drop the page from every link prefetch.
  it("reads the page without deferring to the request", async () => {
    listTasksMock.mockResolvedValueOnce(taskPage("t1", null));

    await loadProjectsTimeline("UTC");

    expect(connectionMock).not.toHaveBeenCalled();
  });

  it("reads the open Tasks the reader can see across the workspace, due by the last week", async () => {
    listTasksMock.mockResolvedValueOnce(taskPage("t1", null));

    const data = await loadProjectsTimeline("UTC");

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
    expect(data.today).toBe("2026-11-25");
    expect(data.rows[0]?.weeks[0]?.map((task) => task.id)).toEqual(["t1"]);
    expect(data.tasksCut).toBe(false);
    expect(data.projectsCut).toBe(false);
  });

  it("reads today in the reader's time zone", async () => {
    vi.setSystemTime(new Date("2026-11-25T23:30:00.000Z"));
    listTasksMock.mockResolvedValueOnce(taskPage("t1", null));

    const data = await loadProjectsTimeline("Europe/Berlin");

    expect(data.today).toBe("2026-11-26");
  });

  it("follows the cursor and says so when it stops before the end", async () => {
    listTasksMock.mockImplementation(({ cursor }) =>
      Promise.resolve(
        taskPage(`t-${cursor ?? 0}`, `${Number(cursor ?? 0) + 1}`),
      ),
    );

    const data = await loadProjectsTimeline("UTC");

    expect(listTasksMock).toHaveBeenCalledTimes(5);
    expect(listTasksMock.mock.calls[1]?.[0].cursor).toBe("1");
    expect(data.rows[0]?.weeks[0]).toHaveLength(5);
    expect(data.tasksCut).toBe(true);
  });

  it("is cut when Tasks of other projects use up the read, so an empty row is not proof of nothing due", async () => {
    listTasksMock.mockImplementation(({ cursor }) =>
      Promise.resolve(
        taskPage(`other-${cursor ?? 0}`, `${Number(cursor ?? 0) + 1}`, "p9"),
      ),
    );

    const data = await loadProjectsTimeline("UTC");

    expect(data.rows[0]?.hasDueTasks).toBe(false);
    expect(data.tasksCut).toBe(true);
  });

  it("says when there are more open projects than the Timeline read", async () => {
    listProjectsMock.mockResolvedValue({
      projects: [{ id: "p1", name: "Launch" }],
      pagination: { nextCursor: "next" },
    });
    listTasksMock.mockResolvedValueOnce(taskPage("t1", null));

    const data = await loadProjectsTimeline("UTC");

    expect(data.projectsCut).toBe(true);
  });
});
