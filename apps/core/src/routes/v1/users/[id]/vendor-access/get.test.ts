import { OpenAPIHono } from "@hono/zod-openapi";
import { VendorGrantScope, VendorGrantStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";
import { TEST_VENDOR_ID, testVendor } from "@/test-fixtures/vendor";

import mountGetVendorAccess from "./get";

const { userFindUniqueMock, vendorGrantFindManyMock } = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  vendorGrantFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
    vendorGrant: {
      findMany: vendorGrantFindManyMock,
    },
  },
}));

const USER_ID = "user_123";
const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

function createGrantRecord(status: VendorGrantStatus) {
  return {
    id: "01960001-0001-7001-8001-000000000099",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    vendorId: TEST_VENDOR_ID,
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    scope: VendorGrantScope.VENDOR,
    status,
    resolvedAt: null,
    vendor: testVendor,
    workspace: {
      id: WORKSPACE_ID,
      organizationId: null,
      organization: null,
      user: { id: USER_ID, name: "Alex" },
    },
    _count: { tasksAwaitingVendorApproval: 1 },
  };
}

function createApp(
  authContext: AuthVariables["authContext"] = {
    actor: "user",
    userId: USER_ID,
    organizationId: null,
    role: "user",
  },
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHono<{
    Variables: AuthVariables & UserRouteVariables;
  }>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountGetVendorAccess(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id/vendor-access", userByIdApp);

  return app;
}

describe("GET /users/me/vendor-access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: USER_ID });
    vendorGrantFindManyMock.mockResolvedValue([]);
  });

  it("lists grants for the authenticated session user", async () => {
    vendorGrantFindManyMock.mockResolvedValueOnce([
      createGrantRecord(VendorGrantStatus.PENDING),
    ]);

    const app = createApp();
    const response = await app.request("http://localhost/me/vendor-access");

    expect(response.status).toBe(200);
    expect(vendorGrantFindManyMock).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      include: expect.any(Object),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });

  it("filters grants by status when requested", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/me/vendor-access?status=PENDING,GRANTED",
    );

    expect(response.status).toBe(200);
    expect(vendorGrantFindManyMock).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        status: {
          in: [VendorGrantStatus.PENDING, VendorGrantStatus.GRANTED],
        },
      },
      include: expect.any(Object),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });

  it("returns 403 when the path targets another user", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/user_other/vendor-access",
    );

    expect(response.status).toBe(403);
    expect(vendorGrantFindManyMock).not.toHaveBeenCalled();
  });

  it("returns 403 for delegated coworker callers", async () => {
    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
      delegation: {
        userId: USER_ID,
        organizationId: null,
      },
    });
    const response = await app.request("http://localhost/me/vendor-access");

    expect(response.status).toBe(403);
    expect(vendorGrantFindManyMock).not.toHaveBeenCalled();
  });
});
