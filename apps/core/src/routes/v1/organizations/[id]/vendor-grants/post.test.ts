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

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  resolveMemberOrganizationByIdMock,
  vendorFindUniqueMock,
  vendorGrantUpsertMock,
  taskFindManyMock,
  taskUpdateManyMock,
  taskEventCreateMock,
  workspaceFindUniqueMock,
  prismaTransactionMock,
  notificationDeleteManyMock,
} = vi.hoisted(() => ({
  resolveMemberOrganizationByIdMock: vi.fn(),
  vendorFindUniqueMock: vi.fn(),
  vendorGrantUpsertMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
  taskEventCreateMock: vi.fn(),
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
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    if (!authContext) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  mountPostVendorGrant(app);
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
    notificationDeleteManyMock.mockResolvedValue({ count: 0 });
    resolveMemberOrganizationByIdMock.mockResolvedValue({ id: orgId });
    workspaceFindUniqueMock.mockResolvedValue({ id: workspaceId });
    vendorFindUniqueMock.mockResolvedValue({
      id: vendorId,
      name: "Acme",
      slug: "acme",
    });
    taskFindManyMock.mockResolvedValue([
      { id: "task_1", grantResumeStatus: "DRAFT" },
    ]);
    taskUpdateManyMock.mockResolvedValue({ count: 1 });
    taskEventCreateMock.mockResolvedValue({ id: "ev_1" });
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          $queryRaw: vi.fn().mockResolvedValue([]),
          vendorGrant: {
            upsert: vendorGrantUpsertMock,
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
    expect(notificationDeleteManyMock).toHaveBeenCalledWith({
      where: {
        referenceId: grantId,
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
        kind: NotificationKind.SYSTEM,
      },
    });
    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "task_1",
        pendingVendorGrantId: grantId,
        archivedAt: null,
        status: TaskStatus.GRANT_PENDING,
      },
      data: {
        status: TaskStatus.DRAFT,
        pendingVendorGrantId: null,
        grantResumeStatus: null,
      },
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

    expect(response.status).toBe(422);
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

  it("rejects coworker context even with X-Context-User-Id", async () => {
    vendorGrantUpsertMock.mockResolvedValue(baseGrant());

    const coworkerAuth: AuthenticationContext = {
      actor: "coworker",
      coworkerId: "coworker_1",
      vendorId,
      context: { userId: "user_123", organizationId: orgId },
    };

    const response = await createApp(coworkerAuth).request(
      `http://localhost/${orgId}/vendor-grants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId }),
      },
    );

    expect(response.status).toBe(403);
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
    expect(vendorGrantUpsertMock).not.toHaveBeenCalled();
  });

  it("allows orchestrator with context headers as the context user", async () => {
    vendorGrantUpsertMock.mockResolvedValue(baseGrant());

    const response = await createApp({
      actor: "orchestrator",
      orchestratorId: "orch_1",
      context: { userId: "user_123", organizationId: orgId },
    }).request(`http://localhost/${orgId}/vendor-grants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId }),
    });

    expect(response.status).toBe(201);
    expect(notificationDeleteManyMock).toHaveBeenCalledWith({
      where: {
        referenceId: grantId,
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
        kind: NotificationKind.SYSTEM,
      },
    });
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_123", id: orgId }),
    );
  });
});
