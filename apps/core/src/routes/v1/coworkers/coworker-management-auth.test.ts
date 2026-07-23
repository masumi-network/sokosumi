import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

import mountDeleteCoworkerApiKey from "./[id]/api-keys/delete";
import mountGetCoworkerApiKeys from "./[id]/api-keys/get";
import mountPatchCoworkerApiKey from "./[id]/api-keys/patch";
import mountPostCoworkerApiKey from "./[id]/api-keys/post";
import mountDeleteCoworkerById from "./[id]/delete";
import mountPatchCoworkerById from "./[id]/patch";
import mountPatchCoworkerWhitelistById from "./[id]/whitelist/patch";
import mountPostCoworker from "./post";

const {
  userFindUniqueMock,
  coworkerFindFirstMock,
  vendorMemberFindFirstMock,
  coworkerAssignmentFindFirstMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  vendorMemberFindFirstMock: vi.fn(),
  coworkerAssignmentFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
    vendorMember: {
      findFirst: vendorMemberFindFirstMock,
    },
    coworkerAssignment: {
      findFirst: coworkerAssignmentFindFirstMock,
    },
  },
}));

const vendorId = "01960001-0001-7001-8001-000000000001";

function createApp(authContext: AuthenticationContext) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountPostCoworker(app as unknown as OpenAPIHonoWithAuth);
  mountPatchCoworkerById(app as unknown as OpenAPIHonoWithAuth);
  mountDeleteCoworkerById(app as unknown as OpenAPIHonoWithAuth);
  mountGetCoworkerApiKeys(app as unknown as OpenAPIHonoWithAuth);
  mountPostCoworkerApiKey(app as unknown as OpenAPIHonoWithAuth);
  mountPatchCoworkerApiKey(app as unknown as OpenAPIHonoWithAuth);
  mountDeleteCoworkerApiKey(app as unknown as OpenAPIHonoWithAuth);
  mountPatchCoworkerWhitelistById(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

const RESTRICTED_ENDPOINTS: Array<{
  method: string;
  path: string;
  body?: Record<string, unknown>;
  restriction: "membership-or-admin" | "admin-only";
}> = [
  {
    method: "POST",
    path: "/",
    body: {
      name: "Ops Agent",
      vendorId,
    },
    restriction: "admin-only",
  },
  {
    method: "PATCH",
    path: "/cow_123/whitelist",
    body: {
      isWhitelisted: true,
    },
    restriction: "admin-only",
  },
  {
    method: "PATCH",
    path: "/cow_123",
    body: {
      name: "Updated name",
    },
    restriction: "membership-or-admin",
  },
  {
    method: "DELETE",
    path: "/cow_123",
    restriction: "membership-or-admin",
  },
  {
    method: "GET",
    path: "/cow_123/api-keys",
    restriction: "membership-or-admin",
  },
  {
    method: "POST",
    path: "/cow_123/api-keys",
    body: {
      name: "Key 1",
    },
    restriction: "membership-or-admin",
  },
  {
    method: "PATCH",
    path: "/cow_123/api-keys/cokey_123",
    body: {
      name: "Updated key",
    },
    restriction: "membership-or-admin",
  },
  {
    method: "DELETE",
    path: "/cow_123/api-keys/cokey_123",
    restriction: "membership-or-admin",
  },
];

describe("coworker management endpoints auth guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({
      role: "user",
    });
    coworkerFindFirstMock.mockResolvedValue({
      id: "cow_123",
      vendorId,
    });
    vendorMemberFindFirstMock.mockResolvedValue(null);
    coworkerAssignmentFindFirstMock.mockResolvedValue(null);
  });

  it.each(RESTRICTED_ENDPOINTS)(
    "returns 403 for user without vendor membership access on $method $path",
    async ({ method, path, body, restriction }) => {
      const app = createApp({
        actor: "user",
        userId: "user_123",
        organizationId: null,
        role: "user",
      });

      const response = await app.request(`http://localhost${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      expect(response.status).toBe(403);
      if (restriction === "membership-or-admin") {
        expect(coworkerFindFirstMock).toHaveBeenCalledWith({
          where: { id: "cow_123", archivedAt: null },
          select: { id: true, vendorId: true },
        });
      }
    },
  );

  it.each(RESTRICTED_ENDPOINTS)(
    "returns 403 for coworker actor on $method $path",
    async ({ method, path, body }) => {
      const app = createApp({
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId,
      });

      const response = await app.request(`http://localhost${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      expect(response.status).toBe(403);
    },
  );
});
