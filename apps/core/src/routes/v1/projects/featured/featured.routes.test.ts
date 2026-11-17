import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountProjectFeaturedRoutes from "../[id]/featured/routes.js";
import mountGetFeaturedProject from "./get.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { lockCalendarScopeMock } = vi.hoisted(() => ({
  lockCalendarScopeMock: vi.fn(),
}));

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
}));

vi.mock("@/services/cmo-cuso.service", () => ({
  cmoProjectIds: vi.fn(async () => new Set<string>()),
}));

const {
  workspaceFindUniqueMock,
  workspaceFindUniqueOrThrowMock,
  workspaceUpdateMock,
  workspaceUpdateManyMock,
  memberFindUniqueMock,
  projectFindFirstMock,
  projectHideFindUniqueMock,
} = vi.hoisted(() => ({
  workspaceFindUniqueMock: vi.fn(),
  workspaceFindUniqueOrThrowMock: vi.fn(),
  workspaceUpdateMock: vi.fn(),
  workspaceUpdateManyMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  projectHideFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => {
  const client = {
    workspace: {
      findUnique: workspaceFindUniqueMock,
      findUniqueOrThrow: workspaceFindUniqueOrThrowMock,
      update: workspaceUpdateMock,
      updateMany: workspaceUpdateManyMock,
    },
    member: { findUnique: memberFindUniqueMock },
    project: { findFirstOrThrow: projectFindFirstMock },
    projectHide: { findUnique: projectHideFindUniqueMock },
  };
  return {
    default: {
      ...client,
      $transaction: async (callback: (tx: typeof client) => unknown) =>
        await callback(client),
    },
  };
});

const USER_ID = "user_123";
const ORGANIZATION_ID = "org_123";
const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORGANIZATION_ID,
  role: "user",
};

const ORGANIZATION_WORKSPACE = {
  workspaceId: WORKSPACE_ID,
  userId: null,
  organizationId: ORGANIZATION_ID,
} satisfies WorkspaceVariables["workspaceContext"];

const PERSONAL_WORKSPACE = {
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
  organizationId: null,
} satisfies WorkspaceVariables["workspaceContext"];

const PROJECT_ROW = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  createdAt: new Date("2026-11-01T10:00:00.000Z"),
  updatedAt: new Date("2026-11-02T10:00:00.000Z"),
  name: "Spring launch",
  identifier: "SPR",
  filesToken: null,
  briefing: null,
  briefingUrl: null,
  contextMd: null,
  contextMdUrl: null,
  contextMdUpdatedAt: null,
  contextMdModel: null,
  contextMdUpdatingSince: null,
  contextMdVersion: 0,
  latestUpdateMd: null,
  latestUpdateMdUpdatedAt: null,
  websiteUrl: null,
  sitePlatform: null,
  logo: null,
  studioLogoPosition: null,
  studioBrandLook: null,
  studioBrandLookRevision: 0,
  designMdUrl: null,
  designMdExtractionId: null,
  postingInstructionsMd: null,
  projectRevision: 0,
  calendarRevision: 0,
  closingAt: null,
  closedAt: null,
};

function createApp(
  workspaceContext: WorkspaceVariables["workspaceContext"] = ORGANIZATION_WORKSPACE,
) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", USER_AUTH_CONTEXT);
    c.set("workspaceContext", workspaceContext);
    return await next();
  });
  mountGetFeaturedProject(app);
  mountProjectFeaturedRoutes(app);
  return app;
}

function asRole(role: string | null) {
  memberFindUniqueMock.mockResolvedValue(role ? { role } : null);
}

beforeEach(() => {
  vi.clearAllMocks();
  asRole("member");
  workspaceFindUniqueMock.mockResolvedValue({
    featuredProject: PROJECT_ROW,
  });
  projectHideFindUniqueMock.mockResolvedValue(null);
  projectFindFirstMock.mockResolvedValue({
    id: PROJECT_ID,
    closedAt: null,
    closingAt: null,
  });
  lockCalendarScopeMock.mockResolvedValue(true);
  workspaceFindUniqueOrThrowMock.mockResolvedValue({ featuredProjectId: null });
  workspaceUpdateMock.mockResolvedValue({});
  workspaceUpdateManyMock.mockResolvedValue({ count: 1 });
});

describe("GET /projects/featured", () => {
  it("returns the organization's featured Project to a member who cannot change it", async () => {
    const res = await createApp().request("http://localhost/featured");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.project).toMatchObject({
      id: PROJECT_ID,
      name: "Spring launch",
    });
    expect(body.data.canFeature).toBe(false);
  });

  it("tells an owner or admin they can feature", async () => {
    asRole("admin");
    const res = await createApp().request("http://localhost/featured");

    expect((await res.json()).data.canFeature).toBe(true);
  });

  it("returns no Project when nothing is featured", async () => {
    workspaceFindUniqueMock.mockResolvedValue({ featuredProject: null });
    const res = await createApp().request("http://localhost/featured");

    expect((await res.json()).data.project).toBeUndefined();
  });

  it("skips a featured Project that is closing or closed", async () => {
    workspaceFindUniqueMock.mockResolvedValue({
      featuredProject: { ...PROJECT_ROW, closingAt: new Date() },
    });
    const res = await createApp().request("http://localhost/featured");

    expect((await res.json()).data.project).toBeUndefined();
  });

  it("skips a featured Project the reader has Hidden", async () => {
    projectHideFindUniqueMock.mockResolvedValue({ id: "hide_1" });
    const res = await createApp().request("http://localhost/featured");

    expect((await res.json()).data.project).toBeUndefined();
  });

  it("has nothing to feature in a personal workspace", async () => {
    const res = await createApp(PERSONAL_WORKSPACE).request(
      "http://localhost/featured",
    );

    const body = await res.json();
    expect(body.data).toEqual({ canFeature: false });
    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("PUT /projects/{id}/featured", () => {
  function feature(projectId = PROJECT_ID) {
    return createApp().request(`http://localhost/${projectId}/featured`, {
      method: "PUT",
    });
  }

  it("lets an owner or admin feature an open Project of the workspace", async () => {
    asRole("owner");
    const res = await feature();

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ featuredProjectId: PROJECT_ID });
    expect(workspaceUpdateMock).toHaveBeenCalledWith({
      where: { id: WORKSPACE_ID },
      data: { featuredProjectId: PROJECT_ID },
    });
  });

  it("refuses a plain member", async () => {
    const res = await feature();

    expect(res.status).toBe(403);
    expect(workspaceUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses a personal workspace", async () => {
    const res = await createApp(PERSONAL_WORKSPACE).request(
      `http://localhost/${PROJECT_ID}/featured`,
      { method: "PUT" },
    );

    expect(res.status).toBe(403);
    expect(workspaceUpdateMock).not.toHaveBeenCalled();
  });

  it("reads a Project from another workspace as absent", async () => {
    asRole("admin");
    lockCalendarScopeMock.mockResolvedValue(false);
    const res = await feature();

    expect(res.status).toBe(404);
    expect(workspaceUpdateMock).not.toHaveBeenCalled();
  });

  it("checks the Project under the close's locks, in its order", async () => {
    asRole("admin");
    await feature();

    // Actor, Workspace, then Project: the order a close takes them in.
    expect(lockCalendarScopeMock).toHaveBeenCalledWith(
      expect.anything(),
      WORKSPACE_ID,
      [PROJECT_ID],
      USER_ID,
    );
  });

  it("refuses a closing or closed Project", async () => {
    asRole("admin");
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      closedAt: new Date(),
      closingAt: null,
    });
    const res = await feature();

    expect(res.status).toBe(422);
    expect(workspaceUpdateMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /projects/{id}/featured", () => {
  function unfeature() {
    return createApp().request(`http://localhost/${PROJECT_ID}/featured`, {
      method: "DELETE",
    });
  }

  it("clears the feature only while this Project still holds it", async () => {
    asRole("admin");
    const res = await unfeature();

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ featuredProjectId: null });
    // Scoped to the Project, so a stale Stop featuring never clears a
    // Project another admin featured since.
    expect(workspaceUpdateManyMock).toHaveBeenCalledWith({
      where: { id: WORKSPACE_ID, featuredProjectId: PROJECT_ID },
      data: { featuredProjectId: null },
    });
  });

  it("answers with the Project another admin featured since", async () => {
    asRole("admin");
    workspaceUpdateManyMock.mockResolvedValue({ count: 0 });
    workspaceFindUniqueOrThrowMock.mockResolvedValue({
      featuredProjectId: "22222222-2222-4222-8222-222222222222",
    });
    const res = await unfeature();

    expect((await res.json()).data).toEqual({
      featuredProjectId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("refuses a plain member", async () => {
    const res = await unfeature();

    expect(res.status).toBe(403);
    expect(workspaceUpdateManyMock).not.toHaveBeenCalled();
  });
});
