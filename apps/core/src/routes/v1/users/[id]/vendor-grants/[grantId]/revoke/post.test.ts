import { OpenAPIHono } from "@hono/zod-openapi";
import { VendorGrantStatus, VendorPermission } from "@sokosumi/database";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

const {
  cancelParkedTasksForGrantMock,
  vendorGrantFindFirstMock,
  vendorGrantUpdateMock,
  workspaceFindUniqueMock,
  prismaTransactionMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  cancelParkedTasksForGrantMock: vi.fn(),
  vendorGrantFindFirstMock: vi.fn(),
  vendorGrantUpdateMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/helpers/vendor-grants", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/vendor-grants")>();

  return {
    ...actual,
    cancelParkedTasksForGrant: cancelParkedTasksForGrantMock,
  };
});

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

let mountRevokeUserVendorGrant: (
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
  mountRevokeUserVendorGrant(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);
  return app;
}

beforeAll(async () => {
  const module = await import("./post");
  mountRevokeUserVendorGrant = module.default;
});

describe("POST /users/{id}/vendor-grants/{grantId}/revoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    workspaceFindUniqueMock.mockResolvedValue({ id: workspaceId });
    cancelParkedTasksForGrantMock.mockResolvedValue(1);
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          vendorGrant: {
            findFirst: vendorGrantFindFirstMock,
            update: vendorGrantUpdateMock,
          },
        }),
    );
  });

  it("revokes GRANTED task:create and cancels still-parked tasks", async () => {
    const existing = {
      id: grantId,
      vendorId,
      workspaceId,
      permission: VendorPermission.task_create,
      status: VendorGrantStatus.GRANTED,
      requestedByUserId: null,
      resolvedAt: new Date("2026-07-01T12:00:00.000Z"),
      resolvedById: "user_123",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T12:00:00.000Z"),
      vendor: { name: "Acme", slug: "acme" },
    };
    const updated = {
      ...existing,
      status: VendorGrantStatus.REVOKED,
      resolvedAt: new Date("2026-07-02T00:00:00.000Z"),
      resolvedById: "user_123",
    };

    vendorGrantFindFirstMock.mockResolvedValue(existing);
    vendorGrantUpdateMock.mockResolvedValue(updated);

    const response = await createApp().request(
      `http://localhost/me/vendor-grants/${grantId}/revoke`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(cancelParkedTasksForGrantMock).toHaveBeenCalledWith(
      grantId,
      expect.anything(),
    );
  });
});
