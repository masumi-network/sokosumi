import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGetTaskContacts from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { contactActorMock, requireTaskReadMock, taskContactFindManyMock } =
  vi.hoisted(() => ({
    contactActorMock: vi.fn(),
    requireTaskReadMock: vi.fn(),
    taskContactFindManyMock: vi.fn(),
  }));

vi.mock("@/helpers/access-control", () => ({
  requireTaskReadForRouteVars: requireTaskReadMock,
}));
vi.mock("@/routes/v1/contacts/context", () => ({
  contactActor: contactActorMock,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { taskContact: { findMany: taskContactFindManyMock } },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const CONTACT = { id: "01960001-0001-7001-8001-000000000077", name: "Maya" };

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("requestId", "req_task_contacts_test");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: null,
      organizationId: "org_123",
    });
    return await next();
  });
  mountGetTaskContacts(app);
  return app;
}

describe("GET /tasks/{id}/contacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contactActorMock.mockResolvedValue({ workspaceId: WORKSPACE_ID });
    requireTaskReadMock.mockResolvedValue({
      id: "tsk_1",
      workspaceId: WORKSPACE_ID,
    });
    taskContactFindManyMock.mockResolvedValue([{ contact: CONTACT }]);
  });

  it("lists the live contacts tagged on a readable Task", async () => {
    const response = await createApp().request(
      "http://localhost/tsk_1/contacts",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: [CONTACT] });
    expect(taskContactFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          taskId: "tsk_1",
          contact: { workspaceId: WORKSPACE_ID, archivedAt: null },
        },
      }),
    );
  });

  it("shows no contacts for a Task outside the active workspace", async () => {
    requireTaskReadMock.mockResolvedValue({
      id: "tsk_1",
      workspaceId: "22222222-2222-7222-8222-222222222222",
    });

    const response = await createApp().request(
      "http://localhost/tsk_1/contacts",
    );

    await expect(response.json()).resolves.toMatchObject({ data: [] });
    expect(taskContactFindManyMock).not.toHaveBeenCalled();
  });

  it("is not found when the reader cannot see the Task", async () => {
    const { notFound } = await import("@/helpers/error");
    requireTaskReadMock.mockRejectedValue(notFound("Task not found"));

    const response = await createApp().request(
      "http://localhost/tsk_1/contacts",
    );

    expect(response.status).toBe(404);
    expect(taskContactFindManyMock).not.toHaveBeenCalled();
  });
});
