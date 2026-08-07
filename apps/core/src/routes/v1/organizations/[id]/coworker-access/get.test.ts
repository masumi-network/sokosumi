import { OpenAPIHono } from "@hono/zod-openapi";
import { CoworkerWorkspaceAccessStatus, MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const { listMock, resolveMemberOrganizationByIdMock, workspaceFindUniqueMock } =
  vi.hoisted(() => ({
    listMock: vi.fn(),
    resolveMemberOrganizationByIdMock: vi.fn(),
    workspaceFindUniqueMock: vi.fn(),
  }));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findUnique: workspaceFindUniqueMock },
  },
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

import mountGetOrganizationCoworkerAccess from "./get";

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
  mountGetOrganizationCoworkerAccess(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /organizations/{id}/coworker-access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveMemberOrganizationByIdMock.mockResolvedValue({ id: orgId });
    workspaceFindUniqueMock.mockResolvedValue({ id: workspaceId });
  });

  it("lists coworker access for org workspace (owner/admin)", async () => {
    listMock.mockResolvedValue([
      {
        id: accessId,
        coworkerId,
        coworker: { name: "Ops Pilot", slug: "ops-pilot" },
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
      `http://localhost/${orgId}/coworker-access`,
      { method: "GET" },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: accessId,
      status: "PENDING",
    });
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      }),
    );
    expect(listMock).toHaveBeenCalledWith(workspaceId);
  });

  it("rejects non-owner/admin with 403", async () => {
    resolveMemberOrganizationByIdMock.mockRejectedValue(
      forbidden("Organization admin access required"),
    );

    const response = await createApp().request(
      `http://localhost/${orgId}/coworker-access`,
      { method: "GET" },
    );

    expect(response.status).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("rejects coworker context with 403", async () => {
    const response = await createApp({
      actor: "coworker",
      coworkerId: "coworker_1",
      vendorId: "vendor_1",
      context: { userId: "user_123", organizationId: orgId },
    }).request(`http://localhost/${orgId}/coworker-access`, { method: "GET" });

    expect(response.status).toBe(403);
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
    expect(listMock).not.toHaveBeenCalled();
  });
});
