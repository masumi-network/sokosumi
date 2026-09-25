import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readRouteSession: vi.fn(),
  getProjectById: vi.fn(),
}));

vi.mock("@/lib/auth/route-session", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/route-session")>(
    "@/lib/auth/route-session",
  )),
  readRouteSession: mocks.readRouteSession,
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { getProjectById: mocks.getProjectById },
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";

import { GET } from "./route";

function read(projectId: string) {
  return GET(new Request(`https://web.test/api/project-scope/${projectId}`), {
    params: Promise.resolve({ projectId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readRouteSession.mockResolvedValue({
    status: "authenticated",
    session: { user: { id: "user-1" } },
  });
});

describe("GET /api/project-scope/[projectId]", () => {
  it("answers with the project's name and logo only", async () => {
    mocks.getProjectById.mockResolvedValue({
      id: "p-1",
      name: "Alpha",
      logo: null,
      briefing: "not for the switcher",
    });

    const response = await read("p-1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      project: { id: "p-1", name: "Alpha", logo: null },
    });
    expect(mocks.getProjectById).toHaveBeenCalledWith("p-1");
  });

  it("answers null for a project the reader cannot see", async () => {
    mocks.getProjectById.mockResolvedValue(null);

    expect(await (await read("p-1")).json()).toEqual({ project: null });
  });

  it("answers null for an id Core rejects as malformed", async () => {
    // Core's request validation answers 422 for `not-a-uuid`.
    mocks.getProjectById.mockRejectedValue(
      new CoreApiRequestError("Bad id", { status: 422 }),
    );

    const response = await read("null");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ project: null });
  });

  it("passes a Core outage through as an error", async () => {
    mocks.getProjectById.mockRejectedValue(
      new CoreApiRequestError("Down", { status: 503 }),
    );

    expect((await read("p-1")).status).toBe(503);
  });

  it("refuses a signed-out reader without asking Core", async () => {
    mocks.readRouteSession.mockResolvedValue({ status: "signedOut" });

    expect((await read("p-1")).status).toBe(401);
    expect(mocks.getProjectById).not.toHaveBeenCalled();
  });
});
