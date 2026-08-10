import { OpenAPIHono } from "@hono/zod-openapi";
import { CoworkerWorkspaceAccessStatus, MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFound } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const {
  revokeMock,
  resolveMemberOrganizationByIdMock,
  workspaceFindUniqueMock,
  prismaTransactionMock,
  publishMembershipStatusMock,
} = vi.hoisted(() => ({
  revokeMock: vi.fn(),
  resolveMemberOrganizationByIdMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  publishMembershipStatusMock: vi.fn(),
}));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findUnique: workspaceFindUniqueMock },
    $transaction: prismaTransactionMock,
  },
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

import mountRevokeOrganizationCoworkerAccess from "./post";

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

const accessId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const coworkerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const workspaceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const orgId = "org_123";
const now = new Date("2026-08-05T12:00:00.000Z");

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
  mountRevokeOrganizationCoworkerAccess(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("POST /organizations/{id}/coworker-access/{accessId}/revoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveMemberOrganizationByIdMock.mockResolvedValue({ id: orgId });
    workspaceFindUniqueMock.mockResolvedValue({ id: workspaceId });
    publishMembershipStatusMock.mockResolvedValue(undefined);
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback({}),
    );
  });

  it("revokes GRANTED access → 200 REVOKED", async () => {
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
      membershipStatusMessages: [],
    });

    const response = await createApp().request(
      `http://localhost/${orgId}/coworker-access/${accessId}/revoke`,
      { method: "POST" },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: accessId,
      status: "REVOKED",
    });
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      }),
    );
    expect(revokeMock).toHaveBeenCalledWith(
      {
        accessId,
        workspaceId,
        resolvedById: "user_123",
      },
      {},
    );
    expect(publishMembershipStatusMock).toHaveBeenCalledWith(
      [],
      "chat membership status after coworker access revoke",
    );
  });

  it("returns 404 when access not in workspace", async () => {
    revokeMock.mockRejectedValue(
      notFound("Coworker workspace access not found"),
    );

    const response = await createApp().request(
      `http://localhost/${orgId}/coworker-access/${accessId}/revoke`,
      { method: "POST" },
    );

    expect(response.status).toBe(404);
  });
});
