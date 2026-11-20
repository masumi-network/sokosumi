import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectionMock = vi.fn(async () => undefined);
const listProjectsMock = vi.fn();
const getProjectCloseStatusMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => undefined }));
vi.mock("next/server", () => ({ connection: () => connectionMock() }));
vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    listProjects: listProjectsMock,
    getProjectCloseStatus: getProjectCloseStatusMock,
  },
}));

const { loadProjectsPageData } = await import("./projects-page-data");

const PAGE = { projects: [{ id: "project-1" }], pagination: null };

describe("loadProjectsPageData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listProjectsMock.mockReset();
    getProjectCloseStatusMock.mockReset();
  });

  // connection() would drop the page from every link prefetch.
  it("reads the page without deferring to the request", async () => {
    listProjectsMock.mockResolvedValue(PAGE);

    const data = await loadProjectsPageData({ query: "", state: "open" });

    expect(data.projectsPage).toEqual(PAGE);
    expect(connectionMock).not.toHaveBeenCalled();
  });

  // The cached read must not keep a failed read, so the click renders
  // fresh and the page reads Core again.
  it("renders a failed read fresh on the click", async () => {
    listProjectsMock
      .mockRejectedValueOnce(new Error("Core answered 503"))
      .mockResolvedValue(PAGE);

    const data = await loadProjectsPageData({ query: "", state: "open" });

    expect(connectionMock).toHaveBeenCalledOnce();
    expect(data.projectsPage).toEqual(PAGE);
  });

  // A Core 401 redirects to sign-in; the prefetch must carry it.
  it("keeps a sign-in redirect from the cached read", async () => {
    listProjectsMock.mockImplementation(async () => redirect("/signin"));

    await expect(
      loadProjectsPageData({ query: "", state: "open" }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(connectionMock).not.toHaveBeenCalled();
  });

  it("adds what a closing card's close still owes, and nothing to others", async () => {
    listProjectsMock.mockResolvedValue({
      projects: [
        {
          id: "closing",
          closingAt: "2026-09-10T08:00:00.000Z",
          closedAt: null,
        },
        {
          id: "failed-read",
          closingAt: "2026-09-10T08:00:00.000Z",
          closedAt: null,
        },
        { id: "open", closingAt: null, closedAt: null },
      ],
      pagination: null,
    });
    getProjectCloseStatusMock.mockImplementation(async (id: string) => {
      if (id === "failed-read") throw new Error("Core answered 503");
      return { id: "op", state: "CLOSING", owedOccurrenceCount: 2 };
    });

    const { projectsPage } = await loadProjectsPageData({
      query: "",
      state: "open",
    });

    expect(projectsPage.projects).toEqual([
      expect.objectContaining({
        id: "closing",
        closeStatus: { state: "CLOSING", owedOccurrenceCount: 2 },
      }),
      expect.objectContaining({ id: "failed-read", closeStatus: null }),
      { id: "open", closingAt: null, closedAt: null },
    ]);
    expect(getProjectCloseStatusMock).toHaveBeenCalledTimes(2);
  });

  it("names the other views a filter matches when this one has none", async () => {
    listProjectsMock.mockImplementation(async ({ state }: { state: string }) =>
      state === "hidden"
        ? { projects: [{ id: "spring" }], pagination: null }
        : { projects: [], pagination: null },
    );

    const data = await loadProjectsPageData({ query: "SPR", state: "open" });

    expect(data.otherMatches).toEqual(["hidden"]);
    expect(listProjectsMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: "SPR", state: "closed", limit: 1 }),
    );
  });

  it("looks in no other view without a filter or with matches here", async () => {
    listProjectsMock.mockResolvedValue(PAGE);

    const data = await loadProjectsPageData({ query: "SPR", state: "open" });

    expect(data.otherMatches).toEqual([]);
    expect(listProjectsMock).toHaveBeenCalledOnce();
  });
});
