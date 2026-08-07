import { OpenAPIHono } from "@hono/zod-openapi";
import { CoworkerWorkspaceAccessStatus, MemberRole } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden, notFound } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const {
  approveMock,
  resolveMemberOrganizationByIdMock,
  workspaceFindUniqueMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  approveMock: vi.fn(),
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
    approveCoworkerWorkspaceAccess: (...args: unknown[]) =>
      approveMock(...args),
  };
});

import mountApproveOrganizationCoworkerAccess from "./post";

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

function createApp(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    if (!authContext) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  mountApproveOrganizationCoworkerAccess(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("POST /organizations/{id}/coworker-access/{accessId}/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveMemberOrganizationByIdMock.mockResolvedValue({ id: orgId });
    workspaceFindUniqueMock.mockResolvedValue({ id: workspaceId });
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback({}),
    );
  });

  it("approves PENDING access → 200 GRANTED", async () => {
    approveMock.mockResolvedValue({
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
      status: CoworkerWorkspaceAccessStatus.GRANTED,
      requestedByUserId: "requester",
      resolvedAt: now,
      resolvedById: "user_123",
      createdAt: now,
      updatedAt: now,
    });

    const response = await createApp().request(
      `http://localhost/${orgId}/coworker-access/${accessId}/approve`,
      { method: "POST" },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: accessId,
      status: "GRANTED",
      resolvedById: "user_123",
    });
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
        userId: "user_123",
      }),
    );
    expect(approveMock).toHaveBeenCalledWith(
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
      context: { userId: "user_123", organizationId: orgId },
    }).request(
      `http://localhost/${orgId}/coworker-access/${accessId}/approve`,
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("rejects non-owner/admin with 403", async () => {
    resolveMemberOrganizationByIdMock.mockRejectedValue(
      forbidden("Organization admin access required"),
    );

    const response = await createApp().request(
      `http://localhost/${orgId}/coworker-access/${accessId}/approve`,
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("returns 404 when access not in workspace", async () => {
    approveMock.mockRejectedValue(
      notFound("Coworker workspace access not found"),
    );

    const response = await createApp().request(
      `http://localhost/${orgId}/coworker-access/${accessId}/approve`,
      { method: "POST" },
    );

    expect(response.status).toBe(404);
  });
});
