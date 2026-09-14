import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

const {
  memberFindFirstMock,
  projectEventFindManyMock,
  resolveMemberOrganizationByIdMock,
  taskEventFindManyMock,
  taskScheduleOccurrenceFindManyMock,
  userFindManyMock,
  workspaceFindUniqueMock,
} = vi.hoisted(() => ({
  memberFindFirstMock: vi.fn(),
  projectEventFindManyMock: vi.fn(),
  resolveMemberOrganizationByIdMock: vi.fn(),
  taskEventFindManyMock: vi.fn(),
  taskScheduleOccurrenceFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    member: { findFirst: memberFindFirstMock },
    projectEvent: { findMany: projectEventFindManyMock },
    taskEvent: { findMany: taskEventFindManyMock },
    taskScheduleOccurrence: {
      findMany: taskScheduleOccurrenceFindManyMock,
    },
    user: { findMany: userFindManyMock },
    workspace: { findUnique: workspaceFindUniqueMock },
  },
}));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: (...args: unknown[]) =>
    resolveMemberOrganizationByIdMock(...args),
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_current",
  organizationId: null,
  role: "user",
};

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";

let mountPostCalendarIdentityLabels: (app: OpenAPIHonoWithAuth) => void;

function createApp(activeWorkspaceId = WORKSPACE_ID) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_calendar_identity_labels");
    c.set("isAuthenticated", true);
    c.set("authContext", USER_AUTH_CONTEXT);
    c.set("workspaceContext", {
      workspaceId: activeWorkspaceId,
      userId: "user_current",
      organizationId: null,
    });
    return await next();
  });
  mountPostCalendarIdentityLabels(app);
  return app;
}

function requestLabels(app: OpenAPIHonoWithAuth, refs: string[]) {
  return app.request(
    `http://localhost/${WORKSPACE_ID}/calendar/identity-labels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refs }),
    },
  );
}

describe("POST /workspaces/{id}/calendar/identity-labels", () => {
  beforeAll(async () => {
    const module = await import("./post");
    mountPostCalendarIdentityLabels = module.default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    memberFindFirstMock.mockResolvedValue({ id: "calendar_beta_member" });
    workspaceFindUniqueMock.mockResolvedValue({
      userId: "user_current",
      organizationId: null,
    });
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([]);
    projectEventFindManyMock.mockResolvedValue([]);
    taskEventFindManyMock.mockResolvedValue([]);
    userFindManyMock.mockResolvedValue([]);
  });

  it("reveals only the current personal owner among proven Calendar actors", async () => {
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([
      { actorUserId: "user_current" },
      { actorUserId: "user_former" },
    ]);
    projectEventFindManyMock.mockResolvedValue([
      { actorUserId: "user_deleted" },
    ]);
    taskEventFindManyMock.mockResolvedValue([{ userId: "user_current" }]);
    userFindManyMock.mockResolvedValue([
      { id: "user_current", name: "Ada Lovelace" },
    ]);

    const response = await requestLabels(createApp(), [
      "user_current",
      "user_former",
      "user_deleted",
      "user_unknown",
    ]);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          ref: "user_current",
          state: "current_member",
          label: "Ada Lovelace",
        },
        { ref: "user_former", state: "former_member" },
        { ref: "user_deleted", state: "former_member" },
        { ref: "user_unknown", state: "unknown" },
      ],
      meta: expect.objectContaining({
        requestId: "req_calendar_identity_labels",
      }),
    });
    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenCalledWith({
      where: {
        sourceWorkspaceId: WORKSPACE_ID,
        actorUserId: {
          in: ["user_current", "user_former", "user_deleted", "user_unknown"],
        },
      },
      distinct: ["actorUserId"],
      select: { actorUserId: true },
    });
    expect(projectEventFindManyMock).toHaveBeenCalledWith({
      where: {
        project: { workspaceId: WORKSPACE_ID },
        actorUserId: {
          in: ["user_current", "user_former", "user_deleted", "user_unknown"],
        },
      },
      distinct: ["actorUserId"],
      select: { actorUserId: true },
    });
    expect(taskEventFindManyMock).toHaveBeenCalledWith({
      where: {
        task: { workspaceId: WORKSPACE_ID },
        scheduleKind: { not: null },
        userId: {
          in: ["user_current", "user_former", "user_deleted", "user_unknown"],
        },
      },
      distinct: ["userId"],
      select: { userId: true },
    });
    expect(userFindManyMock).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["user_current", "user_former", "user_deleted"],
        },
        workspace: { id: WORKSPACE_ID },
      },
      select: { id: true, name: true },
    });
  });

  it("reveals only current organization members among proven actors", async () => {
    workspaceFindUniqueMock.mockResolvedValue({
      userId: null,
      organizationId: "org_123",
    });
    resolveMemberOrganizationByIdMock.mockResolvedValue({ id: "org_123" });
    taskEventFindManyMock.mockResolvedValue([
      { userId: "user_current" },
      { userId: "user_former" },
    ]);
    userFindManyMock.mockResolvedValue([
      { id: "user_current", name: "Current member" },
    ]);

    const response = await requestLabels(createApp(), [
      "user_current",
      "user_former",
    ]);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          ref: "user_current",
          state: "current_member",
          label: "Current member",
        },
        { ref: "user_former", state: "former_member" },
      ],
      meta: expect.any(Object),
    });
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith({
      id: "org_123",
      userId: "user_current",
      tx: expect.anything(),
    });
    expect(userFindManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ["user_current", "user_former"] },
        members: { some: { organizationId: "org_123" } },
      },
      select: { id: true, name: true },
    });
  });

  it("does not resolve a current member whose ref is not proven by Calendar data", async () => {
    const response = await requestLabels(createApp(), ["user_unproven"]);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [{ ref: "user_unproven", state: "unknown" }],
      meta: expect.any(Object),
    });
    expect(userFindManyMock).not.toHaveBeenCalled();
  });

  it("requires the requested workspace to be active", async () => {
    const response = await requestLabels(
      createApp("22222222-2222-7222-8222-222222222222"),
      ["user_current"],
    );

    expect(response.status).toBe(403);
    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
  });

  it("requires Calendar beta access", async () => {
    memberFindFirstMock.mockResolvedValue(null);

    const response = await requestLabels(createApp(), ["user_current"]);

    expect(response.status).toBe(403);
    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
  });

  it("rejects batches larger than 50 refs", async () => {
    const response = await requestLabels(
      createApp(),
      Array.from({ length: 51 }, (_, index) => `user_${index}`),
    );

    expect(response.status).toBe(422);
    expect(memberFindFirstMock).not.toHaveBeenCalled();
  });
});
