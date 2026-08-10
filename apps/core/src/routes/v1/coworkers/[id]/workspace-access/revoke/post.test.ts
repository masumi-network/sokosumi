import { OpenAPIHono } from "@hono/zod-openapi";
import { CoworkerWorkspaceAccessStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden, notFound } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

const {
  forceRevokeMock,
  resolveWorkspaceMock,
  prismaTransactionMock,
  coworkerFindFirstMock,
  requireVendorAdminMembershipMock,
} = vi.hoisted(() => ({
  forceRevokeMock: vi.fn(),
  resolveWorkspaceMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  requireVendorAdminMembershipMock: vi.fn(),
}));

vi.mock("@/helpers/coworker-workspace-access", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/helpers/coworker-workspace-access")
    >();
  return {
    ...actual,
    forceRevokeCoworkerWorkspaceAccessByPair: (...args: unknown[]) =>
      forceRevokeMock(...args),
    resolveCoworkerAccessTargetWorkspaceId: (...args: unknown[]) =>
      resolveWorkspaceMock(...args),
  };
});

vi.mock("@/helpers/vendor-membership", () => ({
  requireVendorAdminMembership: (...args: unknown[]) =>
    requireVendorAdminMembershipMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
    coworker: {
      findFirst: (...args: unknown[]) => coworkerFindFirstMock(...args),
    },
  },
}));

import mountPostRevokeCoworkerWorkspaceAccess from "./post";

const coworkerId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const vendorId = "01960001-0001-7001-8001-000000000001";
const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accessId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const actorUserId = "admin_1";
const now = new Date("2026-08-05T12:00:00.000Z");

function baseAccess(
  overrides: { status?: CoworkerWorkspaceAccessStatus } = {},
) {
  return {
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
    status: overrides.status ?? CoworkerWorkspaceAccessStatus.REVOKED,
    requestedByUserId: null,
    resolvedAt: now,
    resolvedById: actorUserId,
    createdAt: now,
    updatedAt: now,
  };
}

function createApp(role = "admin", userId = actorUserId) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId: null,
      role,
    });
    return await next();
  });

  mountPostRevokeCoworkerWorkspaceAccess(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

async function postRevoke(app: ReturnType<typeof createApp>) {
  return app.request(`http://localhost/${coworkerId}/workspace-access/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
}

describe("POST /coworkers/{id}/workspace-access/revoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveWorkspaceMock.mockResolvedValue(workspaceId);
    coworkerFindFirstMock.mockResolvedValue({ id: coworkerId, vendorId });
    requireVendorAdminMembershipMock.mockResolvedValue(undefined);
    prismaTransactionMock.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    );
  });

  it("revokes GRANTED access for platform admin without vendor check", async () => {
    forceRevokeMock.mockResolvedValue(baseAccess());

    const response = await postRevoke(createApp("admin"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: accessId,
      coworkerId,
      coworkerName: "Ops Pilot",
      coworkerSlug: "ops-pilot",
      workspaceId,
      status: CoworkerWorkspaceAccessStatus.REVOKED,
    });
    expect(requireVendorAdminMembershipMock).not.toHaveBeenCalled();
    expect(forceRevokeMock).toHaveBeenCalledWith(
      {
        coworkerId,
        workspaceId,
        resolvedById: actorUserId,
      },
      expect.anything(),
    );
  });

  it("revokes GRANTED access for vendor admin of the coworker", async () => {
    forceRevokeMock.mockResolvedValue(baseAccess());

    const response = await postRevoke(createApp("user", "vendor_admin"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireVendorAdminMembershipMock).toHaveBeenCalledWith(
      "vendor_admin",
      vendorId,
    );
    expect(forceRevokeMock).toHaveBeenCalled();
    expect(body.data.status).toBe(CoworkerWorkspaceAccessStatus.REVOKED);
  });

  it("returns 403 when user is not platform admin or vendor admin", async () => {
    requireVendorAdminMembershipMock.mockRejectedValue(
      forbidden("Vendor admin access required"),
    );

    const response = await postRevoke(createApp("user", "stranger"));

    expect(response.status).toBe(403);
    expect(forceRevokeMock).not.toHaveBeenCalled();
  });

  it("returns 404 when coworker is missing", async () => {
    coworkerFindFirstMock.mockResolvedValue(null);

    const response = await postRevoke(createApp("admin"));

    expect(response.status).toBe(404);
    expect(forceRevokeMock).not.toHaveBeenCalled();
  });

  it("returns 404 when helper throws not found", async () => {
    forceRevokeMock.mockRejectedValue(
      notFound("Coworker workspace access not found"),
    );

    const response = await postRevoke(createApp("admin"));

    expect(response.status).toBe(404);
  });
});
