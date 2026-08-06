import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const { workspaceFindUniqueMock, resolveMemberOrganizationByIdMock } =
  vi.hoisted(() => ({
    workspaceFindUniqueMock: vi.fn(),
    resolveMemberOrganizationByIdMock: vi.fn(),
  }));

vi.mock("@/middleware/auth", () => ({
  requireUserContext: (authContext: AuthenticationContext | null) => {
    if (!authContext || authContext.actor !== "user") {
      throw new HTTPException(403, { message: "User authentication required" });
    }
    return { source: "session" as const, ...authContext };
  },
  requireOwnerUserContext: (authContext: AuthenticationContext | null) => {
    if (!authContext || authContext.actor !== "user") {
      throw new HTTPException(403, { message: "User authentication required" });
    }
    return { source: "session" as const, ...authContext };
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: {
      findUnique: workspaceFindUniqueMock,
    },
  },
}));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: (...args: unknown[]) =>
    resolveMemberOrganizationByIdMock(...args),
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";

let mountGetWorkspaceById: (app: OpenAPIHonoWithAuth) => void;

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  mountGetWorkspaceById(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

beforeAll(async () => {
  const module = await import("./get");
  mountGetWorkspaceById = module.default;
});

describe("GET /workspaces/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns organizationId for an organization workspace the user belongs to", async () => {
    workspaceFindUniqueMock.mockResolvedValueOnce({
      userId: null,
      organizationId: "org_1",
    });
    resolveMemberOrganizationByIdMock.mockResolvedValueOnce({
      id: "org_1",
      name: "Org One",
    });

    const app = createApp();
    const response = await app.request(`http://localhost/${WORKSPACE_ID}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        organizationId: "org_1",
      },
      meta: expect.objectContaining({
        requestId: "req_123",
      }),
    });
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith({
      id: "org_1",
      userId: "user_123",
      tx: expect.anything(),
    });
  });

  it("returns null organizationId for the caller personal workspace", async () => {
    workspaceFindUniqueMock.mockResolvedValueOnce({
      userId: "user_123",
      organizationId: null,
    });

    const app = createApp();
    const response = await app.request(`http://localhost/${WORKSPACE_ID}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        organizationId: null,
      },
      meta: expect.objectContaining({
        requestId: "req_123",
      }),
    });
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the workspace belongs to another user", async () => {
    workspaceFindUniqueMock.mockResolvedValueOnce({
      userId: "user_other",
      organizationId: null,
    });

    const app = createApp();
    const response = await app.request(`http://localhost/${WORKSPACE_ID}`);

    expect(response.status).toBe(403);
  });

  it("returns 404 when the workspace does not exist", async () => {
    workspaceFindUniqueMock.mockResolvedValueOnce(null);

    const app = createApp();
    const response = await app.request(`http://localhost/${WORKSPACE_ID}`);

    expect(response.status).toBe(404);
  });
});
