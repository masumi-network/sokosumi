import { OpenAPIHono } from "@hono/zod-openapi";
import { CoworkerWorkspaceAccessStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

const { listMock, workspaceFindUniqueMock, userFindUniqueMock } = vi.hoisted(
  () => ({
    listMock: vi.fn(),
    workspaceFindUniqueMock: vi.fn(),
    userFindUniqueMock: vi.fn(),
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findUnique: workspaceFindUniqueMock },
    user: { findUnique: userFindUniqueMock },
  },
}));

// usersPathUserContextMiddleware binds coworker→user via grant/baseline;
// incomplete prisma mocks 500 before requireOwnerUserContext can return 403.
vi.mock("@/helpers/coworker-user-context-binding", () => ({
  assertCoworkerUserContextBinding: vi.fn().mockResolvedValue(undefined),
  requireAuthorizedUserContext: vi.fn(),
}));

vi.mock("@/helpers/coworker-workspace-access", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/helpers/coworker-workspace-access")
    >();
  return {
    ...actual,
    listCoworkerAccessForWorkspace: (...args: unknown[]) => listMock(...args),
  };
});

import mountGetUserCoworkerAccess from "./get";

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const accessId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const coworkerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const workspaceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const now = new Date("2026-08-05T12:00:00.000Z");

function createApp(authContext: AuthenticationContext = SESSION_USER) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHono<{
    Variables: AuthVariables & UserRouteVariables & { requestId: string };
  }>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountGetUserCoworkerAccess(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);
  return app;
}

describe("GET /users/{id}/coworker-access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    workspaceFindUniqueMock.mockResolvedValue({ id: workspaceId });
  });

  it("lists coworker access for personal workspace", async () => {
    listMock.mockResolvedValue([
      {
        id: accessId,
        coworkerId,
        coworker: { name: "Ops Pilot", slug: "ops-pilot" },
        workspace: {
          id: "workspace-1",
          userId: null,
          organizationId: "org-1",
          user: null,
          organization: { name: "Acme Corp", slug: "acme-corp" },
        },
        workspaceId,
        status: CoworkerWorkspaceAccessStatus.PENDING,
        requestedByUserId: "requester",
        resolvedAt: null,
        resolvedById: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const response = await createApp().request(
      "http://localhost/me/coworker-access",
      { method: "GET" },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: accessId,
      status: "PENDING",
      workspaceId,
    });
    expect(listMock).toHaveBeenCalledWith(workspaceId);
  });

  it("rejects coworker context with 403", async () => {
    const response = await createApp({
      actor: "coworker",
      coworkerId: "coworker_1",
      vendorId: "vendor_1",
      context: { userId: "user_123", organizationId: null },
    }).request("http://localhost/user_123/coworker-access", { method: "GET" });

    expect(response.status).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("rejects wrong user path with 403", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "other_user" });

    const response = await createApp().request(
      "http://localhost/other_user/coworker-access",
      { method: "GET" },
    );

    expect(response.status).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });
});
