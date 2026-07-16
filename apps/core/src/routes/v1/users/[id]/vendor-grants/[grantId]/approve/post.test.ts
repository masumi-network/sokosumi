import { OpenAPIHono } from "@hono/zod-openapi";
import {
  TaskStatus,
  VendorGrantStatus,
  VendorPermission,
} from "@sokosumi/database";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

const {
  taskFindManyMock,
  taskUpdateManyMock,
  taskEventCreateMock,
  vendorGrantFindFirstMock,
  vendorGrantUpdateMock,
  workspaceFindUniqueMock,
  prismaTransactionMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  taskFindManyMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
  taskEventCreateMock: vi.fn(),
  vendorGrantFindFirstMock: vi.fn(),
  vendorGrantUpdateMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findUnique: workspaceFindUniqueMock },
    user: { findUnique: userFindUniqueMock },
    $transaction: prismaTransactionMock,
  },
}));

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const grantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const vendorId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const workspaceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let mountApproveUserVendorGrant: (
  app: OpenAPIHonoWithAuth<UserRouteVariables>,
) => void;

function createApp(authContext: AuthenticationContext = SESSION_USER) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHono<{
    Variables: AuthVariables & UserRouteVariables & { requestId: string };
  }>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountApproveUserVendorGrant(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);
  return app;
}

beforeAll(async () => {
  const module = await import("./post");
  mountApproveUserVendorGrant = module.default;
});

describe("POST /users/{id}/vendor-grants/{grantId}/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    workspaceFindUniqueMock.mockResolvedValue({ id: workspaceId });
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
        }),
    );
  });

  it("approves PENDING workspace grant and unparks linked tasks", async () => {
    const existing = {
      id: grantId,
      vendorId,
      workspaceId,
      permission: VendorPermission.workspace,
      status: VendorGrantStatus.PENDING,
      requestedByUserId: "user_ctx",
      resolvedAt: null,
      resolvedById: null,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      vendor: { name: "Acme", slug: "acme" },
    };
    const updated = {
      ...existing,
      status: VendorGrantStatus.GRANTED,
      resolvedAt: new Date("2026-07-02T00:00:00.000Z"),
      resolvedById: "user_123",
    };

    vendorGrantFindFirstMock.mockResolvedValue(existing);
    vendorGrantUpdateMock.mockResolvedValue(updated);

    const response = await createApp().request(
      `http://localhost/me/vendor-grants/${grantId}/approve`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
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

    const body = await response.json();
    expect(body.data).toMatchObject({
      id: grantId,
      permission: "workspace",
      status: "GRANTED",
    });
  });

  it("rejects coworker context with 403", async () => {
    const coworkerAuth: AuthenticationContext = {
      actor: "coworker",
      coworkerId: "coworker_1",
      vendorId,
      context: { userId: "user_123", organizationId: null },
    };

    const response = await createApp(coworkerAuth).request(
      `http://localhost/user_123/vendor-grants/${grantId}/approve`,
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    expect(vendorGrantFindFirstMock).not.toHaveBeenCalled();
  });

  it("re-approves DENIED workspace grant and unparks linked tasks", async () => {
    const existing = {
      id: grantId,
      vendorId,
      workspaceId,
      permission: VendorPermission.workspace,
      status: VendorGrantStatus.DENIED,
      requestedByUserId: null,
      resolvedAt: new Date("2026-07-01T12:00:00.000Z"),
      resolvedById: "user_123",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T12:00:00.000Z"),
      vendor: { name: "Acme", slug: "acme" },
    };
    const updated = {
      ...existing,
      status: VendorGrantStatus.GRANTED,
      resolvedAt: new Date("2026-07-02T00:00:00.000Z"),
      resolvedById: "user_123",
    };

    vendorGrantFindFirstMock.mockResolvedValue(existing);
    vendorGrantUpdateMock.mockResolvedValue(updated);

    const response = await createApp().request(
      `http://localhost/me/vendor-grants/${grantId}/approve`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(vendorGrantUpdateMock).toHaveBeenCalledTimes(1);
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
  });
});
