import { OpenAPIHono } from "@hono/zod-openapi";
import { CoworkerWorkspaceAccessStatus, MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFound } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const {
  denyMock,
  resolveMemberOrganizationByIdMock,
  workspaceFindUniqueMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  denyMock: vi.fn(),
  resolveMemberOrganizationByIdMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
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

import mountDenyOrganizationCoworkerAccess from "./post";

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
  mountDenyOrganizationCoworkerAccess(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("POST /organizations/{id}/coworker-access/{accessId}/deny", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveMemberOrganizationByIdMock.mockResolvedValue({ id: orgId });
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
      workspaceId,
      status: CoworkerWorkspaceAccessStatus.DENIED,
      requestedByUserId: "requester",
      resolvedAt: now,
      resolvedById: "user_123",
      createdAt: now,
      updatedAt: now,
    });

    const response = await createApp().request(
      `http://localhost/${orgId}/coworker-access/${accessId}/deny`,
      { method: "POST" },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: accessId,
      status: "DENIED",
    });
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      }),
    );
    expect(denyMock).toHaveBeenCalledWith(
      {
        accessId,
        workspaceId,
        resolvedById: "user_123",
      },
      {},
    );
  });

  it("returns 404 when access not in workspace", async () => {
    denyMock.mockRejectedValue(notFound("Coworker workspace access not found"));

    const response = await createApp().request(
      `http://localhost/${orgId}/coworker-access/${accessId}/deny`,
      { method: "POST" },
    );

    expect(response.status).toBe(404);
  });
});
