import { OpenAPIHono } from "@hono/zod-openapi";
import {
  MemberRole,
  VendorGrantStatus,
  VendorPermission,
} from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const {
  resolveMemberOrganizationByIdMock,
  vendorFindUniqueMock,
  vendorGrantUpsertMock,
  taskUpdateManyMock,
  workspaceFindUniqueMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  resolveMemberOrganizationByIdMock: vi.fn(),
  vendorFindUniqueMock: vi.fn(),
  vendorGrantUpsertMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/middleware/auth", () => ({
  requireUserContext: (authContext: AuthenticationContext | null) => {
    if (!authContext || authContext.actor !== "user") {
      throw new HTTPException(403, { message: "User authentication required" });
    }
    return { source: "session" as const, ...authContext };
  },
}));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findUnique: workspaceFindUniqueMock },
    vendor: { findUnique: vendorFindUniqueMock },
    $transaction: prismaTransactionMock,
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

const grantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const vendorId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const workspaceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const orgId = "org_123";

let mountPostVendorGrant: (app: OpenAPIHonoWithAuth) => void;

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
  mountPostVendorGrant(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function baseGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: grantId,
    vendorId,
    workspaceId,
    permission: VendorPermission.workspace,
    status: VendorGrantStatus.GRANTED,
    requestedByUserId: null,
    resolvedAt: new Date("2026-07-02T00:00:00.000Z"),
    resolvedById: "user_123",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
    vendor: { name: "Acme", slug: "acme" },
    ...overrides,
  };
}

beforeAll(async () => {
  const module = await import("./post");
  mountPostVendorGrant = module.default;
});

describe("POST /organizations/{id}/vendor-grants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveMemberOrganizationByIdMock.mockResolvedValue({ id: orgId });
    workspaceFindUniqueMock.mockResolvedValue({ id: workspaceId });
    vendorFindUniqueMock.mockResolvedValue({
      id: vendorId,
      name: "Acme",
      slug: "acme",
    });
    taskUpdateManyMock.mockResolvedValue({ count: 1 });
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          vendorGrant: {
            upsert: vendorGrantUpsertMock,
          },
          task: {
            updateMany: taskUpdateManyMock,
          },
        }),
    );
  });

  it("grants workspace access and unparks tasks awaiting that grant", async () => {
    vendorGrantUpsertMock.mockResolvedValue(baseGrant());

    const response = await createApp().request(
      `http://localhost/${orgId}/vendor-grants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId }),
      },
    );

    expect(response.status).toBe(201);
    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: { pendingVendorGrantId: grantId },
      data: { pendingVendorGrantId: null },
    });
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      }),
    );

    const body = await response.json();
    expect(body.data).toMatchObject({
      id: grantId,
      permission: "workspace",
      status: "GRANTED",
    });
  });

  it("rejects requests missing vendorId", async () => {
    const response = await createApp().request(
      `http://localhost/${orgId}/vendor-grants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(400);
    expect(vendorGrantUpsertMock).not.toHaveBeenCalled();
  });

  it("returns 404 when vendor is missing", async () => {
    vendorFindUniqueMock.mockResolvedValue(null);

    const response = await createApp().request(
      `http://localhost/${orgId}/vendor-grants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId }),
      },
    );

    expect(response.status).toBe(404);
    expect(vendorGrantUpsertMock).not.toHaveBeenCalled();
  });
});
