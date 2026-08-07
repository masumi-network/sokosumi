import { OpenAPIHono } from "@hono/zod-openapi";
import {
  MemberRole,
  NotificationKind,
  TaskStatus,
  VendorGrantStatus,
  VendorPermission,
} from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { VENDOR_GRANT_PENDING_MESSAGE_KEY } from "@/helpers/notification-feed";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const {
  resolveMemberOrganizationByIdMock,
  taskFindManyMock,
  taskUpdateManyMock,
  taskEventCreateMock,
  vendorGrantFindFirstMock,
  vendorGrantUpdateMock,
  workspaceFindUniqueMock,
  prismaTransactionMock,
  notificationDeleteManyMock,
} = vi.hoisted(() => ({
  resolveMemberOrganizationByIdMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
  taskEventCreateMock: vi.fn(),
  vendorGrantFindFirstMock: vi.fn(),
  vendorGrantUpdateMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  notificationDeleteManyMock: vi.fn(),
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

let mountDenyVendorGrant: (app: OpenAPIHonoWithAuth) => void;

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
  mountDenyVendorGrant(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

beforeAll(async () => {
  const module = await import("./post");
  mountDenyVendorGrant = module.default;
});

describe("POST /organizations/{id}/vendor-grants/{grantId}/deny", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationDeleteManyMock.mockResolvedValue({ count: 0 });
    resolveMemberOrganizationByIdMock.mockResolvedValue({ id: orgId });
    workspaceFindUniqueMock.mockResolvedValue({ id: workspaceId });
    taskFindManyMock.mockResolvedValue([{ id: "task_1" }]);
    taskUpdateManyMock.mockResolvedValue({ count: 1 });
    taskEventCreateMock.mockResolvedValue({ id: "ev_1" });
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          $queryRaw: vi.fn().mockResolvedValue([]),
          vendorGrant: {
            findFirst: vendorGrantFindFirstMock,
            update: vendorGrantUpdateMock,
          },
          task: {
            findMany: taskFindManyMock,
            updateMany: taskUpdateManyMock,
          },
          taskEvent: {
            create: taskEventCreateMock,
          },
          notification: {
            deleteMany: notificationDeleteManyMock,
          },
        }),
    );
  });

  it("denies PENDING workspace grant and cancels parked tasks", async () => {
    const existing = {
      id: grantId,
      vendorId,
      workspaceId,
      permission: VendorPermission.workspace,
      status: VendorGrantStatus.PENDING,
      requestedByUserId: null,
      resolvedAt: null,
      resolvedById: null,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      vendor: { name: "Acme", slug: "acme" },
    };
    const updated = {
      ...existing,
      status: VendorGrantStatus.DENIED,
      resolvedAt: new Date("2026-07-02T00:00:00.000Z"),
      resolvedById: "user_123",
    };

    vendorGrantFindFirstMock.mockResolvedValue(existing);
    vendorGrantUpdateMock.mockResolvedValue(updated);

    const response = await createApp().request(
      `http://localhost/${orgId}/vendor-grants/${grantId}/deny`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(notificationDeleteManyMock).toHaveBeenCalledWith({
      where: {
        referenceId: grantId,
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
        kind: NotificationKind.SYSTEM,
      },
    });
    expect(vendorGrantUpdateMock).toHaveBeenCalledTimes(1);
    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "task_1",
        pendingVendorGrantId: grantId,
        archivedAt: null,
        status: TaskStatus.GRANT_PENDING,
      },
      data: {
        status: TaskStatus.CANCELED,
        pendingVendorGrantId: null,
        grantResumeStatus: null,
      },
    });
    expect(taskEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: "task_1",
        status: "CANCELED",
        userId: "user_123",
      }),
    });
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      }),
    );
  });

  it("rejects coworker context even with X-Context-User-Id", async () => {
    const existing = {
      id: grantId,
      vendorId,
      workspaceId,
      permission: VendorPermission.workspace,
      status: VendorGrantStatus.PENDING,
      requestedByUserId: null,
      resolvedAt: null,
      resolvedById: null,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      vendor: { name: "Acme", slug: "acme" },
    };
    vendorGrantFindFirstMock.mockResolvedValue(existing);

    const response = await createApp({
      actor: "coworker",
      coworkerId: "coworker_1",
      vendorId,
      context: { userId: "user_123", organizationId: orgId },
    }).request(`http://localhost/${orgId}/vendor-grants/${grantId}/deny`, {
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
    expect(vendorGrantFindFirstMock).not.toHaveBeenCalled();
  });

  it("allows orchestrator with context headers as the context user", async () => {
    const existing = {
      id: grantId,
      vendorId,
      workspaceId,
      permission: VendorPermission.workspace,
      status: VendorGrantStatus.PENDING,
      requestedByUserId: null,
      resolvedAt: null,
      resolvedById: null,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      vendor: { name: "Acme", slug: "acme" },
    };
    vendorGrantFindFirstMock.mockResolvedValue(existing);
    vendorGrantUpdateMock.mockResolvedValue({
      ...existing,
      status: VendorGrantStatus.DENIED,
      resolvedAt: new Date("2026-07-02T00:00:00.000Z"),
      resolvedById: "user_123",
    });

    const response = await createApp({
      actor: "orchestrator",
      orchestratorId: "orch_1",
      context: { userId: "user_123", organizationId: orgId },
    }).request(`http://localhost/${orgId}/vendor-grants/${grantId}/deny`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(notificationDeleteManyMock).toHaveBeenCalledWith({
      where: {
        referenceId: grantId,
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
        kind: NotificationKind.SYSTEM,
      },
    });
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_123" }),
    );
  });
});
