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
  vendorFindUniqueMock,
  vendorGrantUpsertMock,
  taskFindManyMock,
  taskUpdateManyMock,
  taskEventCreateMock,
  workspaceFindUniqueMock,
  prismaTransactionMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  vendorFindUniqueMock: vi.fn(),
  vendorGrantUpsertMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
  taskEventCreateMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findUnique: workspaceFindUniqueMock },
    vendor: { findUnique: vendorFindUniqueMock },
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

let mountPostUserVendorGrant: (
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
  mountPostUserVendorGrant(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);
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
  mountPostUserVendorGrant = module.default;
});

describe("POST /users/{id}/vendor-grants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
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
        }),
    );
  });

  it("grants workspace access for personal workspace and unparks tasks", async () => {
    vendorGrantUpsertMock.mockResolvedValue(baseGrant());

    const response = await createApp().request(
      "http://localhost/me/vendor-grants",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId }),
      },
    );

    expect(response.status).toBe(201);
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

  it("returns 403 when caller cannot access the target user", async () => {
    const response = await createApp().request(
      "http://localhost/other_user/vendor-grants",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId }),
      },
    );

    expect(response.status).toBe(403);
  });
});
