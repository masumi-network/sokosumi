import { OpenAPIHono } from "@hono/zod-openapi";
import { CoworkerWorkspaceAccessStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

const {
  coworkerFindFirstMock,
  accessFindManyMock,
  requireVendorAdminMembershipMock,
} = vi.hoisted(() => ({
  coworkerFindFirstMock: vi.fn(),
  accessFindManyMock: vi.fn(),
  requireVendorAdminMembershipMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: {
      findFirst: (...args: unknown[]) => coworkerFindFirstMock(...args),
    },
    coworkerWorkspaceAccess: {
      findMany: (...args: unknown[]) => accessFindManyMock(...args),
    },
  },
}));

vi.mock("@/helpers/vendor-membership", () => ({
  requireVendorAdminMembership: (...args: unknown[]) =>
    requireVendorAdminMembershipMock(...args),
}));

import mountGetCoworkerWorkspaceAccess from "./get";

const coworkerId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const vendorId = "01960001-0001-7001-8001-000000000001";
const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accessId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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
    status: overrides.status ?? CoworkerWorkspaceAccessStatus.PENDING,
    requestedByUserId: "user_123",
    resolvedAt: null,
    resolvedById: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createApp(role = "user", userId = "user_123") {
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

  mountGetCoworkerWorkspaceAccess(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /coworkers/{id}/workspace-access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireVendorAdminMembershipMock.mockResolvedValue(undefined);
  });

  it("platform admin lists access rows without vendor membership check", async () => {
    coworkerFindFirstMock.mockResolvedValue({ id: coworkerId, vendorId });
    accessFindManyMock.mockResolvedValue([
      baseAccess({ status: CoworkerWorkspaceAccessStatus.GRANTED }),
      baseAccess({ status: CoworkerWorkspaceAccessStatus.PENDING }),
    ]);

    const response = await createApp("admin").request(
      `http://localhost/${coworkerId}/workspace-access`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({
      id: accessId,
      coworkerId,
      coworkerName: "Ops Pilot",
      coworkerSlug: "ops-pilot",
      workspaceId,
      status: "GRANTED",
    });
    expect(requireVendorAdminMembershipMock).not.toHaveBeenCalled();
    expect(accessFindManyMock).toHaveBeenCalledWith({
      where: { coworkerId },
      orderBy: { createdAt: "desc" },
      include: {
        coworker: {
          select: { name: true, slug: true },
        },
        workspace: {
          select: {
            id: true,
            userId: true,
            organizationId: true,
            user: {
              select: {
                name: true,
                email: true,
              },
            },
            organization: {
              select: {
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    });
  });

  it("vendor admin lists access rows for own coworker", async () => {
    coworkerFindFirstMock.mockResolvedValue({ id: coworkerId, vendorId });
    accessFindManyMock.mockResolvedValue([baseAccess()]);

    const response = await createApp("user", "vendor_admin").request(
      `http://localhost/${coworkerId}/workspace-access`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].status).toBe("PENDING");
    expect(requireVendorAdminMembershipMock).toHaveBeenCalledWith(
      "vendor_admin",
      vendorId,
    );
  });

  it("vendor admin list redacts personal workspace email", async () => {
    coworkerFindFirstMock.mockResolvedValue({ id: coworkerId, vendorId });
    accessFindManyMock.mockResolvedValue([
      {
        ...baseAccess({ status: CoworkerWorkspaceAccessStatus.GRANTED }),
        workspace: {
          id: "ws-personal",
          userId: "user-owner-1",
          organizationId: null,
          user: { name: "Pilot Owner", email: "pilot@example.com" },
          organization: null,
        },
      },
    ]);

    const response = await createApp("user", "vendor_admin").request(
      `http://localhost/${coworkerId}/workspace-access`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0]).toMatchObject({
      workspaceKind: "user",
      workspaceDisplayName: "Pilot Owner",
      workspaceDisplayDetail: "user-owner-1",
    });
    expect(body.data[0].workspaceDisplayDetail).not.toBe("pilot@example.com");
  });

  it("platform admin list keeps personal workspace email", async () => {
    coworkerFindFirstMock.mockResolvedValue({ id: coworkerId, vendorId });
    accessFindManyMock.mockResolvedValue([
      {
        ...baseAccess({ status: CoworkerWorkspaceAccessStatus.GRANTED }),
        workspace: {
          id: "ws-personal",
          userId: "user-owner-1",
          organizationId: null,
          user: { name: "Pilot Owner", email: "pilot@example.com" },
          organization: null,
        },
      },
    ]);

    const response = await createApp("admin").request(
      `http://localhost/${coworkerId}/workspace-access`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0].workspaceDisplayDetail).toBe("pilot@example.com");
  });

  it("random user → 403", async () => {
    coworkerFindFirstMock.mockResolvedValue({ id: coworkerId, vendorId });
    requireVendorAdminMembershipMock.mockRejectedValue(
      forbidden("Vendor admin access required"),
    );

    const response = await createApp("user", "stranger").request(
      `http://localhost/${coworkerId}/workspace-access`,
    );

    expect(response.status).toBe(403);
    expect(accessFindManyMock).not.toHaveBeenCalled();
  });

  it("missing coworker → 404", async () => {
    coworkerFindFirstMock.mockResolvedValue(null);

    const response = await createApp("admin").request(
      `http://localhost/${coworkerId}/workspace-access`,
    );

    expect(response.status).toBe(404);
    expect(requireVendorAdminMembershipMock).not.toHaveBeenCalled();
    expect(accessFindManyMock).not.toHaveBeenCalled();
  });
});
