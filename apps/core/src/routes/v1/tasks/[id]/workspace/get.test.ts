import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetTaskWorkspace from "./get";

const { resolveMemberOrganizationByIdMock, taskFindUniqueMock } = vi.hoisted(
  () => ({
    resolveMemberOrganizationByIdMock: vi.fn(),
    taskFindUniqueMock: vi.fn(),
  }),
);

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: {
      findUnique: taskFindUniqueMock,
    },
  },
}));

function createTask(
  overrides: { userId?: string; organizationId?: string | null } = {},
) {
  const organizationId =
    "organizationId" in overrides ? overrides.organizationId : "org_123";

  return {
    name: "Research competitor pricing",
    userId: overrides.userId ?? "user_123",
    workspaceId: "11111111-1111-7111-8111-111111111111",
    workspace: {
      organizationId,
    },
  };
}

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    });

    return await next();
  });

  mountGetTaskWorkspace(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("GET /tasks/{id}/workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskFindUniqueMock.mockResolvedValue(createTask());
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: {
        id: "org_123",
      },
      role: "member",
    });
  });

  it("returns the task title and workspace mapping for accessible tasks", async () => {
    const response = await createApp().request("/tsk_123/workspace");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      name: "Research competitor pricing",
      workspaceId: "11111111-1111-7111-8111-111111111111",
      organizationId: "org_123",
    });
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith({
      id: "org_123",
      userId: "user_123",
      tx: expect.any(Object),
    });
  });

  it("allows personal tasks owned by the caller", async () => {
    taskFindUniqueMock.mockResolvedValue(
      createTask({
        organizationId: null,
      }),
    );

    const response = await createApp().request("/tsk_123/workspace");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      name: "Research competitor pricing",
      organizationId: null,
    });
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
  });
});
