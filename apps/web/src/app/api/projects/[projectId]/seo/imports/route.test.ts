import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  getWorkspace: vi.fn(),
  getTasks: vi.fn(),
  getTaskById: vi.fn(),
}));
vi.mock("@/lib/auth/route-session", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/route-session")>(
    "@/lib/auth/route-session",
  )),
  readRouteSession: mocks.session,
}));
vi.mock("@/lib/services/seo.service", () => ({
  seoServiceNoRedirect: { getWorkspace: mocks.getWorkspace },
}));
vi.mock("@/lib/clients/core.client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/clients/core.client")>(
    "@/lib/clients/core.client",
  )),
  coreClientNoRedirect: {
    getTasks: mocks.getTasks,
    getTaskById: mocks.getTaskById,
  },
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { seoViewerHeaders } from "@/lib/seo/owner";
import { GET } from "./route";

const PROJECT = "39d1c2a6-aade-4322-aed5-3f139a34b127";
const task = {
  id: "report-task",
  name: "SEO audit",
  status: "COMPLETED",
  ownerId: "owner",
  visibility: "PUBLIC",
  projectId: null,
};
function read(query = "") {
  return GET(
    new Request(
      `https://web.test/api/projects/${PROJECT}/seo/imports?${query}`,
      { headers: seoViewerHeaders("owner", null) },
    ),
    { params: Promise.resolve({ projectId: PROJECT }) },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    status: "authenticated",
    session: { user: { id: "owner" }, session: { activeOrganizationId: null } },
  });
  mocks.getWorkspace.mockResolvedValue({ projectId: PROJECT });
});
describe("SEO import sources", () => {
  it("rejects an old personal-workspace read after the same user selects an organization", async () => {
    mocks.session.mockResolvedValue({
      status: "authenticated",
      session: {
        user: { id: "owner" },
        session: { activeOrganizationId: "org-b" },
      },
    });
    expect((await read()).status).toBe(409);
    expect(mocks.getWorkspace).not.toHaveBeenCalled();
    expect(mocks.getTasks).not.toHaveBeenCalled();
    expect(mocks.getTaskById).not.toHaveBeenCalled();
  });

  it("lists authorized Task summaries without loading every Task's files", async () => {
    mocks.getTasks.mockResolvedValue({
      data: [task, { ...task, id: "other", projectId: "another-project" }],
      meta: { pagination: { nextCursor: "next" } },
    });
    const response = await read("q=audit");
    expect(await response.json()).toEqual({
      tasks: [task],
      nextCursor: "next",
    });
    expect(mocks.getTaskById).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("loads the chosen Task details only after Project authority succeeds", async () => {
    const details = { ...task, files: [{ id: "artifact" }] };
    mocks.getTaskById.mockResolvedValue({ data: details });
    expect(await (await read("taskId=report-task")).json()).toEqual({
      task: details,
    });
    expect(mocks.getTasks).not.toHaveBeenCalled();
    mocks.getWorkspace.mockRejectedValue(
      new CoreApiRequestError("Denied", { status: 403 }),
    );
    mocks.getTaskById.mockClear();
    expect((await read("taskId=report-task")).status).toBe(403);
    expect(mocks.getTaskById).not.toHaveBeenCalled();
  });
  it.each([
    { visibility: "PRIVATE" },
    { projectId: "other-project" },
    { ownerId: "other" },
    { status: "RUNNING" },
  ])("refuses an ineligible selected Task: %j", async (changed) => {
    mocks.getTaskById.mockResolvedValue({ data: { ...task, ...changed } });
    expect((await read("taskId=report-task")).status).toBe(404);
  });
});
