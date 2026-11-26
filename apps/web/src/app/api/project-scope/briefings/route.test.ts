import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readRouteSession: vi.fn(),
  listProjects: vi.fn(),
  getProjectById: vi.fn(),
}));

vi.mock("@/lib/auth/route-session", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/route-session")>(
    "@/lib/auth/route-session",
  )),
  readRouteSession: mocks.readRouteSession,
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    listProjects: mocks.listProjects,
    getProjectById: mocks.getProjectById,
  },
}));

import { GET as getBriefing } from "../[projectId]/briefing/route";
import { GET } from "./route";

const scope = { userId: "user-1", organizationId: "org-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readRouteSession.mockResolvedValue({
    status: "authenticated",
    session: {
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    },
  });
});

describe("GET /api/project-scope/briefings", () => {
  it("answers one page of names of projects with a briefing, and the next cursor", async () => {
    mocks.listProjects.mockResolvedValue({
      projects: [
        { id: "a", name: "Alpha", briefing: "Alpha brief" },
        { id: "e", name: "Empty", briefing: "  " },
        { id: "n", name: "None", briefing: null },
      ],
      pagination: { nextCursor: "page-2" },
    });

    const response = await GET(
      new Request("https://web.test/api/project-scope/briefings?cursor=page-1"),
    );

    expect(await response.json()).toEqual({
      scope,
      data: { sources: [{ id: "a", name: "Alpha" }], nextCursor: "page-2" },
    });
    expect(mocks.listProjects).toHaveBeenCalledWith({
      cursor: "page-1",
      limit: 100,
    });
  });

  it("starts at the first page without a cursor", async () => {
    mocks.listProjects.mockResolvedValue({ projects: [], pagination: null });

    await GET(new Request("https://web.test/api/project-scope/briefings"));

    expect(mocks.listProjects).toHaveBeenCalledWith({
      cursor: null,
      limit: 100,
    });
  });

  it("fails the read, not the page, when Core is down", async () => {
    mocks.listProjects.mockRejectedValue(new Error("Core is down"));

    const response = await GET(
      new Request("https://web.test/api/project-scope/briefings"),
    );

    expect(response.status).toBe(502);
  });
});

describe("GET /api/project-scope/[projectId]/briefing", () => {
  it("answers the briefing of a project the reader can open", async () => {
    mocks.getProjectById.mockResolvedValue({
      id: "a",
      briefing: "Alpha brief",
    });

    const response = await getBriefing(new Request("https://web.test"), {
      params: Promise.resolve({ projectId: "a" }),
    });

    expect(await response.json()).toEqual({
      scope,
      data: { briefing: "Alpha brief" },
    });
    expect(mocks.getProjectById).toHaveBeenCalledWith("a");
  });

  it("answers no briefing for a project Core does not show the reader", async () => {
    mocks.getProjectById.mockResolvedValue(null);

    const response = await getBriefing(new Request("https://web.test"), {
      params: Promise.resolve({ projectId: "other" }),
    });

    expect(await response.json()).toEqual({ scope, data: { briefing: null } });
  });
});
