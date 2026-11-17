import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectionMock = vi.fn(async () => undefined);
const listProjectsMock = vi.fn();
const getFeaturedProjectMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => undefined }));
vi.mock("next/server", () => ({ connection: () => connectionMock() }));
vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    listProjects: listProjectsMock,
    getFeaturedProject: getFeaturedProjectMock,
  },
}));

const { loadProjectsPageData } = await import("./projects-page-data");

const PAGE = { projects: [{ id: "project-1" }], pagination: null };

describe("loadProjectsPageData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listProjectsMock.mockReset();
    getFeaturedProjectMock.mockResolvedValue({ canFeature: false });
  });

  it("reads the featured Project for the unfiltered Open view only", async () => {
    listProjectsMock.mockResolvedValue(PAGE);
    const featured = { project: { id: "project-2" }, canFeature: true };
    getFeaturedProjectMock.mockResolvedValue(featured);

    expect(
      (await loadProjectsPageData({ query: "", state: "open" })).featured,
    ).toEqual(featured);
    expect(
      (await loadProjectsPageData({ query: "launch", state: "open" })).featured,
    ).toBeNull();
    expect(
      (await loadProjectsPageData({ query: "", state: "closed" })).featured,
    ).toBeNull();
    expect(getFeaturedProjectMock).toHaveBeenCalledOnce();
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
});
