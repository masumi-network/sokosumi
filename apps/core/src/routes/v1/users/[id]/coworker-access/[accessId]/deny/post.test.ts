import { CoworkerWorkspaceAccessStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFound } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  denyMock,
  workspaceFindUniqueMock,
  prismaTransactionMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  denyMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findUnique: workspaceFindUniqueMock },
    user: { findUnique: userFindUniqueMock },
    $transaction: prismaTransactionMock,
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
    denyCoworkerWorkspaceAccess: (...args: unknown[]) => denyMock(...args),
  };
});

import mountDenyUserCoworkerAccess from "./post";

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
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountDenyUserCoworkerAccess(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

describe("POST /users/{id}/coworker-access/{accessId}/deny", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    workspaceFindUniqueMock.mockResolvedValue({ id: workspaceId });
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback({}),
    );
  });

  it("denies PENDING access → 200 DENIED", async () => {
    denyMock.mockResolvedValue({
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
      status: CoworkerWorkspaceAccessStatus.DENIED,
      requestedByUserId: "requester",
      resolvedAt: now,
      resolvedById: "user_123",
      createdAt: now,
      updatedAt: now,
    });

    const response = await createApp().request(
      `http://localhost/me/coworker-access/${accessId}/deny`,
      { method: "POST" },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: accessId,
      status: "DENIED",
      resolvedById: "user_123",
    });
    expect(denyMock).toHaveBeenCalledWith(
      {
        accessId,
        workspaceId,
        resolvedById: "user_123",
      },
      {},
    );
  });

  it("rejects coworker context with 403", async () => {
    const response = await createApp({
      actor: "coworker",
      coworkerId: "coworker_1",
      vendorId: "vendor_1",
      context: { userId: "user_123", organizationId: null },
    }).request(`http://localhost/user_123/coworker-access/${accessId}/deny`, {
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(denyMock).not.toHaveBeenCalled();
  });

  it("returns 404 when access not in workspace", async () => {
    denyMock.mockRejectedValue(notFound("Coworker workspace access not found"));

    const response = await createApp().request(
      `http://localhost/me/coworker-access/${accessId}/deny`,
      { method: "POST" },
    );

    expect(response.status).toBe(404);
  });
});
