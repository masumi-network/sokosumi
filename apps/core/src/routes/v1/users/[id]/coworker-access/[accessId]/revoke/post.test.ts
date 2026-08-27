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
  revokeMock,
  workspaceFindUniqueMock,
  prismaTransactionMock,
  userFindUniqueMock,
  publishMembershipStatusMock,
} = vi.hoisted(() => ({
  revokeMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  publishMembershipStatusMock: vi.fn(),
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

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMembershipStatusMessagesBestEffort: (...args: unknown[]) =>
    publishMembershipStatusMock(...args),
}));

vi.mock("@/helpers/coworker-workspace-access", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/helpers/coworker-workspace-access")
    >();
  return {
    ...actual,
    revokeCoworkerWorkspaceAccess: (...args: unknown[]) => revokeMock(...args),
  };
});

import mountRevokeUserCoworkerAccess from "./post";

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
  mountRevokeUserCoworkerAccess(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

describe("POST /users/{id}/coworker-access/{accessId}/revoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    workspaceFindUniqueMock.mockResolvedValue({ id: workspaceId });
    publishMembershipStatusMock.mockResolvedValue(undefined);
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback({}),
    );
  });

  it("revokes GRANTED access → 200 REVOKED", async () => {
    const statusMessages = [{ id: "status-1", roomId: "room-1" }];
    revokeMock.mockResolvedValue({
      access: {
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
        status: CoworkerWorkspaceAccessStatus.REVOKED,
        requestedByUserId: "requester",
        resolvedAt: now,
        resolvedById: "user_123",
        createdAt: now,
        updatedAt: now,
      },
      membershipStatusMessages: statusMessages,
    });

    const response = await createApp().request(
      `http://localhost/me/coworker-access/${accessId}/revoke`,
      { method: "POST" },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: accessId,
      status: "REVOKED",
      resolvedById: "user_123",
    });
    expect(revokeMock).toHaveBeenCalledWith(
      {
        accessId,
        workspaceId,
        resolvedById: "user_123",
      },
      {},
    );
    expect(publishMembershipStatusMock).toHaveBeenCalledWith(
      statusMessages,
      "chat membership status after coworker access revoke",
    );
  });

  it("rejects coworker context with 403", async () => {
    const response = await createApp({
      actor: "coworker",
      coworkerId: "coworker_1",
      vendorId: "vendor_1",
      context: { userId: "user_123", organizationId: null },
    }).request(`http://localhost/user_123/coworker-access/${accessId}/revoke`, {
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("returns 404 when access not in workspace", async () => {
    revokeMock.mockRejectedValue(
      notFound("Coworker workspace access not found"),
    );

    const response = await createApp().request(
      `http://localhost/me/coworker-access/${accessId}/revoke`,
      { method: "POST" },
    );

    expect(response.status).toBe(404);
  });
});
