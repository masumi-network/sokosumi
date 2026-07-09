import { OpenAPIHono } from "@hono/zod-openapi";
import { VendorGrantScope, VendorGrantStatus } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";
import { testVendor } from "@/test-fixtures/vendor";

import mountPostApproveVendorGrant from "./[grantId]/approve/post";
import mountPostDenyVendorGrant from "./[grantId]/deny/post";
import mountPostRevokeVendorGrant from "./[grantId]/revoke/post";

const {
  publishTaskEventDataMock,
  serializableTransactionMock,
  userFindUniqueMock,
  vendorGrantFindUniqueMock,
  vendorGrantUpdateMock,
} = vi.hoisted(() => ({
  publishTaskEventDataMock: vi.fn(),
  serializableTransactionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  vendorGrantFindUniqueMock: vi.fn(),
  vendorGrantUpdateMock: vi.fn(),
}));

vi.mock("@/lib/ably/publish", () => ({
  publishTaskEventData: publishTaskEventDataMock,
}));

vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: serializableTransactionMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
    vendorGrant: {
      findUnique: vendorGrantFindUniqueMock,
      update: vendorGrantUpdateMock,
    },
  },
}));

const USER_ID = "user_123";
const GRANT_ID = "01960001-0001-7001-8001-000000000099";
const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

function createGrantRecord(status: VendorGrantStatus) {
  return {
    id: GRANT_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    vendorId: testVendor.id,
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    scope: VendorGrantScope.VENDOR,
    status,
    resolvedAt: null,
  };
}

function createApp(
  mount: (app: OpenAPIHonoWithAuth<UserRouteVariables>) => void,
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: USER_ID,
      organizationId: null,
      role: "user",
    });

    return await next();
  });

  const userByIdApp = new OpenAPIHono<{
    Variables: AuthVariables & UserRouteVariables;
  }>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mount(userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>);
  app.route("/:id/vendor-access", userByIdApp);

  return app;
}

function createTransactionMock() {
  const vendorGrantFindUnique = vi.fn();
  const vendorGrantUpdate = vi.fn();
  const taskFindMany = vi.fn();
  const taskUpdateMany = vi.fn();

  return {
    vendorGrantFindUnique,
    vendorGrantUpdate,
    taskFindMany,
    taskUpdateMany,
    tx: {
      vendorGrant: {
        findUnique: vendorGrantFindUnique,
        update: vendorGrantUpdate,
        findUniqueOrThrow: vi.fn(),
      },
      task: {
        findMany: taskFindMany,
        updateMany: taskUpdateMany,
      },
    },
  };
}

describe("vendor-access lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: USER_ID });
    publishTaskEventDataMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("approves a grant, clears parked tasks, and publishes Ably events", async () => {
    const transaction = createTransactionMock();
    const parkedTaskId = "tsk_parked";

    serializableTransactionMock.mockImplementation(async (callback) => {
      transaction.vendorGrantFindUnique.mockResolvedValueOnce(
        createGrantRecord(VendorGrantStatus.PENDING),
      );
      transaction.taskFindMany.mockResolvedValueOnce([{ id: parkedTaskId }]);
      transaction.vendorGrantUpdate.mockResolvedValue(undefined);
      transaction.tx.vendorGrant.findUniqueOrThrow.mockResolvedValueOnce({
        ...createGrantRecord(VendorGrantStatus.GRANTED),
        vendor: testVendor,
        workspace: {
          id: WORKSPACE_ID,
          organizationId: null,
          organization: null,
          user: { id: USER_ID, name: "Alex" },
        },
        _count: { tasksAwaitingVendorApproval: 0 },
      });

      return await callback(transaction.tx);
    });

    const app = createApp(mountPostApproveVendorGrant);
    const response = await app.request(
      `http://localhost/me/vendor-access/${GRANT_ID}/approve`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(transaction.taskUpdateMany).toHaveBeenCalledWith({
      where: { pendingVendorGrantId: GRANT_ID },
      data: { pendingVendorGrantId: null },
    });
    expect(publishTaskEventDataMock).toHaveBeenCalledWith({
      userId: USER_ID,
      taskId: parkedTaskId,
      eventType: "task_event",
    });
  });

  it("denies a grant, cancels parked tasks, and publishes Ably events", async () => {
    const transaction = createTransactionMock();
    const parkedTaskId = "tsk_parked";

    serializableTransactionMock.mockImplementation(async (callback) => {
      transaction.vendorGrantFindUnique.mockResolvedValueOnce(
        createGrantRecord(VendorGrantStatus.PENDING),
      );
      transaction.taskFindMany.mockResolvedValueOnce([{ id: parkedTaskId }]);
      transaction.vendorGrantUpdate.mockResolvedValue(undefined);
      transaction.tx.vendorGrant.findUniqueOrThrow.mockResolvedValueOnce({
        ...createGrantRecord(VendorGrantStatus.DENIED),
        vendor: testVendor,
        workspace: {
          id: WORKSPACE_ID,
          organizationId: null,
          organization: null,
          user: { id: USER_ID, name: "Alex" },
        },
        _count: { tasksAwaitingVendorApproval: 0 },
      });

      return await callback(transaction.tx);
    });

    const app = createApp(mountPostDenyVendorGrant);
    const response = await app.request(
      `http://localhost/me/vendor-access/${GRANT_ID}/deny`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(transaction.taskUpdateMany).toHaveBeenCalledWith({
      where: { pendingVendorGrantId: GRANT_ID },
      data: {
        status: TaskStatus.CANCELED,
        pendingVendorGrantId: null,
      },
    });
    expect(publishTaskEventDataMock).toHaveBeenCalledWith({
      userId: USER_ID,
      taskId: parkedTaskId,
      eventType: "task_event",
    });
  });

  it("revokes a granted grant without touching already-unparked tasks", async () => {
    const revokedGrant = {
      ...createGrantRecord(VendorGrantStatus.REVOKED),
      vendor: testVendor,
      workspace: {
        id: WORKSPACE_ID,
        organizationId: null,
        organization: null,
        user: { id: USER_ID, name: "Alex" },
      },
      _count: { tasksAwaitingVendorApproval: 0 },
    };

    vendorGrantFindUniqueMock.mockResolvedValueOnce(
      createGrantRecord(VendorGrantStatus.GRANTED),
    );
    vendorGrantUpdateMock.mockResolvedValueOnce(revokedGrant);

    const app = createApp(mountPostRevokeVendorGrant);
    const response = await app.request(
      `http://localhost/me/vendor-access/${GRANT_ID}/revoke`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(vendorGrantUpdateMock).toHaveBeenCalledWith({
      where: { id: GRANT_ID },
      data: {
        status: VendorGrantStatus.REVOKED,
        resolvedAt: expect.any(Date),
      },
      include: expect.any(Object),
    });
    expect(publishTaskEventDataMock).not.toHaveBeenCalled();
  });

  it("re-approves a denied grant without reviving canceled tasks", async () => {
    const transaction = createTransactionMock();

    serializableTransactionMock.mockImplementation(async (callback) => {
      transaction.vendorGrantFindUnique.mockResolvedValueOnce(
        createGrantRecord(VendorGrantStatus.DENIED),
      );
      transaction.taskFindMany.mockResolvedValueOnce([]);
      transaction.vendorGrantUpdate.mockResolvedValue(undefined);
      transaction.tx.vendorGrant.findUniqueOrThrow.mockResolvedValueOnce({
        ...createGrantRecord(VendorGrantStatus.GRANTED),
        vendor: testVendor,
        workspace: {
          id: WORKSPACE_ID,
          organizationId: null,
          organization: null,
          user: { id: USER_ID, name: "Alex" },
        },
        _count: { tasksAwaitingVendorApproval: 0 },
      });

      return await callback(transaction.tx);
    });

    const app = createApp(mountPostApproveVendorGrant);
    const response = await app.request(
      `http://localhost/me/vendor-access/${GRANT_ID}/approve`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(transaction.vendorGrantUpdate).toHaveBeenCalledWith({
      where: { id: GRANT_ID },
      data: {
        status: VendorGrantStatus.GRANTED,
        resolvedAt: expect.any(Date),
      },
    });
    expect(transaction.taskUpdateMany).not.toHaveBeenCalled();
    expect(publishTaskEventDataMock).not.toHaveBeenCalled();
  });
});
