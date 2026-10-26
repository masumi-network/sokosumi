import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readRouteSession: vi.fn(),
  listProjects: vi.fn(),
  listPinnedProjects: vi.fn(),
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
    listPinnedProjects: mocks.listPinnedProjects,
  },
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";

import { GET as getPinned } from "./pinned/route";
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

describe("GET /api/project-scope", () => {
  it("answers the first page with the workspace it was read in", async () => {
    mocks.listProjects.mockResolvedValue({
      projects: [{ id: "p-1", name: "Alpha" }],
      pagination: { nextCursor: null },
    });

    const response = await GET(
      new Request("https://web.test/api/project-scope"),
    );

    expect(await response.json()).toEqual({
      scope,
      data: { projects: [{ id: "p-1", name: "Alpha" }], nextCursor: null },
    });
    expect(mocks.listProjects).toHaveBeenCalledWith({
      cursor: null,
      limit: 20,
      query: undefined,
    });
  });

  it("passes the search on to Core", async () => {
    mocks.listProjects.mockResolvedValue({ projects: [], pagination: null });

    await GET(new Request("https://web.test/api/project-scope?q=%20far%20"));

    expect(mocks.listProjects).toHaveBeenCalledWith(
      expect.objectContaining({ query: "far" }),
    );
  });

  it("refuses a signed-out reader without asking Core", async () => {
    mocks.readRouteSession.mockResolvedValue({ status: "signedOut" });

    const response = await GET(
      new Request("https://web.test/api/project-scope"),
    );

    expect(response.status).toBe(401);
    expect(mocks.listProjects).not.toHaveBeenCalled();
  });

  it("passes Core's error status on", async () => {
    mocks.listProjects.mockRejectedValue(
      new CoreApiRequestError("forbidden", { status: 403 }),
    );

    const response = await GET(
      new Request("https://web.test/api/project-scope"),
    );

    expect(response.status).toBe(403);
  });
});

describe("GET /api/project-scope/pinned", () => {
  it("answers the reader's Pins with the workspace", async () => {
    mocks.listPinnedProjects.mockResolvedValue([{ id: "p-1" }]);

    expect(await (await getPinned()).json()).toEqual({
      scope,
      data: [{ id: "p-1" }],
    });
  });
});
